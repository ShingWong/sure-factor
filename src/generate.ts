import { readFileSync } from 'fs'
import type { SchemaInfo, ColumnInfo } from './introspect'
import type { CatalogType, CatalogComponent } from './types'
import { matchColumnToTypeSync, loadAllTypesSync } from './match'
import { parseYaml } from './parse-yaml'

export type GenerationTier = 'vibe' | 'prototype' | 'production'

export interface GenerateOptions {
  tier: GenerationTier
  component: string
  locale?: string
  theme?: string
}

export interface GeneratedOutput {
  routes: string
  template: string
  i18n: Record<string, string>
  styles: string
  scripts: string[]
  validation: string
  sanitization: string
}

export function generateForTier(schema: SchemaInfo, options: GenerateOptions): GeneratedOutput {
  const { tier, component: componentName } = options

  const component = loadComponent(componentName)
  if (!component) {
    throw new Error(`Component "${componentName}" not found in catalog`)
  }

  const allTypes = loadAllTypesSync()
  const fields: Array<{ column: ColumnInfo; type: CatalogType }> = []
  for (const table of schema.tables) {
    for (const column of table.columns) {
      const matched = matchColumnToTypeSync(column, allTypes, tier)
      if (matched) {
        fields.push({ column, type: matched.type })
      }
    }
  }

  const validationLines: string[] = []
  const sanitizeLines: string[] = []

  for (const { column, type } of fields) {
    const tierConfig = type.tiers?.[tier]
    if (!tierConfig) continue

    if (tierConfig.validation?.regex) {
      const escaped = tierConfig.validation.regex.replace(/\//g, '\\/')
      validationLines.push(`  ${column.columnName}: z.string().regex(/${escaped}/)`)
    }
    if (tierConfig.validation?.maxLength) {
      validationLines.push(`  ${column.columnName}: z.string().max(${tierConfig.validation.maxLength})`)
    }

    if (tierConfig.sanitize?.length) {
      sanitizeLines.push(`  ${column.columnName}: sanitize(input.${column.columnName}, [${tierConfig.sanitize.map(s => `'${s}'`).join(', ')}])`)
    }
  }

  return {
    routes: generateRoutes(schema, fields),
    template: generateTemplate(component, fields, options),
    i18n: generateI18n(fields, options.locale ?? 'en'),
    styles: generateStyles(options.theme ?? 'nord'),
    scripts: component.scripts ?? [],
    validation: validationLines.join('\n'),
    sanitization: sanitizeLines.join('\n'),
  }
}

function loadComponent(name: string): CatalogComponent | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null
  try {
    const text = readFileSync(new URL(`../catalog/components/${name}.yaml`, import.meta.url), 'utf-8')
    return parseYaml(text) as unknown as CatalogComponent
  } catch {
    return null
  }
}

function generateRoutes(schema: SchemaInfo, fields: Array<{ column: ColumnInfo; type: CatalogType }>): string {
  const tableName = schema.tables[0]?.tableName ?? 'resource'
  return `
import { Router } from 'express'
import { z } from 'zod'
import { sanitize } from 'sure-factor/sanitize'

const router = Router()

// Generated from sure-factor catalog
// Table: ${tableName}

export default router
`.trim()
}

function inputTypeForColumn(col: ColumnInfo): string {
  const dt = col.dataType.toLowerCase()
  if (dt === 'boolean') return 'checkbox'
  if (dt === 'date' || dt === 'timestamp' || dt === 'timestamptz') return 'date'
  if (['integer', 'bigint', 'smallint', 'serial', 'bigserial', 'numeric', 'decimal', 'real', 'double'].includes(dt)) return 'number'
  return 'text'
}

function htmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function safeHandlebarKey(value: string): string {
  if (value.includes('}}') || value.includes('{{')) return `invalid-key`
  return value
}

function generateTemplate(component: CatalogComponent, fields: Array<{ column: ColumnInfo; type: CatalogType }>, options: GenerateOptions): string {
  const cc = component.cssClasses ?? {}
  const fClass = cc.field ?? 'field'
  const lClass = cc.label ?? 'field-label'
  const iClass = cc.input ?? 'field-input'
  const eClass = cc.error ?? 'field-error'
  const hClass = cc.help ?? 'field-help'

  const fieldHtml = fields.map(({ column, type }) => {
    const safeName = safeHandlebarKey(column.columnName)
    const attrName = htmlAttr(column.columnName)
    const label = `{{i18n "types.${type.name}.label"}}`
    const placeholder = `{{i18n "types.${type.name}.placeholder"}}`
    const help = `{{i18n "types.${type.name}.help"}}`
    const errorKey = `{{i18n "types.${type.name}.error.format"}}`
    const inputType = inputTypeForColumn(column)
    const inputAttrs = inputType === 'checkbox'
      ? `type="checkbox" id="${attrName}" name="${attrName}" class="${iClass}"`
      : `type="${inputType}" id="${attrName}" name="${attrName}" class="${iClass}" placeholder="${placeholder}" value="{{values.${safeName}}}"`
    return `
  <div class="${fClass}">
    <label class="${lClass}" for="${attrName}">${label}</label>
    <input ${inputAttrs} />
    {{#if errors.${safeName}}}
      <span class="${eClass}" role="alert">${errorKey}</span>
    {{else}}
      <span class="${hClass}">${help}</span>
    {{/if}}
  </div>`
  }).join('\n')

  const formClass = cc.form ?? 'sure-form'
  return `
<form class="${formClass}" hx-post="/{{resource}}" hx-target="this" hx-swap="outerHTML" novalidate>
  ${fieldHtml}
  <button type="submit" class="btn-primary">{{i18n "components.${component.name}.submitLabel"}}</button>
</form>
`.trim()
}

function generateI18n(fields: Array<{ column: ColumnInfo; type: CatalogType }>, locale: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const { type } of fields) {
    const hints = type.hints?.[locale]
    if (hints) {
      result[`types.${type.name}.label`] = type.name
      result[`types.${type.name}.placeholder`] = hints.placeholder ?? ''
      result[`types.${type.name}.help`] = hints.help ?? ''
      result[`types.${type.name}.error.format`] = hints.error?.format ?? ''
      result[`types.${type.name}.error.required`] = hints.error?.required ?? ''
    }
  }
  return result
}

function generateStyles(theme: string): string {
  return `/* Theme: ${theme} — generated by sure-factor */`
}