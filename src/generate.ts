import { readFileSync, existsSync } from 'fs'
import type { SchemaInfo, ColumnInfo } from './introspect.js'
import type { CatalogType, CatalogComponent } from './types.js'
import { matchColumnToTypeSync, loadAllTypesSync } from './match.js'
import { parseYaml } from './parse-yaml.js'

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
  // Keep the owning table on each field. Without it, two tables that both
  // have `updated_at` collide into one object key and silently drop a
  // validator.
  const fields: Array<{ table: string; column: ColumnInfo; type: CatalogType }> = []
  for (const table of schema.tables) {
    for (const column of table.columns) {
      const matched = matchColumnToTypeSync(column, allTypes, tier)
      if (matched) {
        fields.push({ table: table.tableName, column, type: matched.type })
      }
    }
  }

  const validationEntries = new Map<string, string[]>()
  const sanitizeEntries = new Map<string, string[]>()

  for (const { table, column, type } of fields) {
    const tierConfig = type.tiers?.[tier]
    if (!tierConfig) continue

    const key = uniqueKey(validationEntries, table, column.columnName)

    if (tierConfig.validation?.regex) {
      const chain = validationEntries.get(key) ?? []
      chain.push(`.regex(${toRegexLiteral(tierConfig.validation.regex)})`)
      validationEntries.set(key, chain)
    }
    if (tierConfig.validation?.maxLength) {
      const chain = validationEntries.get(key) ?? []
      chain.push(`.max(${tierConfig.validation.maxLength})`)
      validationEntries.set(key, chain)
    }

    if (tierConfig.sanitize?.length) {
      const skey = uniqueKey(sanitizeEntries, table, column.columnName)
      const steps = tierConfig.sanitize.map(sanitizeStepLiteral).join(', ')
      sanitizeEntries.set(skey, [`sanitize(input.${skey}, ${steps})`])
    }
  }

  return {
    routes: generateRoutes(schema, fields),
    template: generateTemplate(component, fields, options),
    i18n: generateI18n(fields, options.locale ?? 'en'),
    styles: generateStyles(component, options.theme ?? 'nord'),
    scripts: resolveComponentScripts(component),
    validation: objectBody(validationEntries),
    sanitization: objectBody(sanitizeEntries, ''),
  }
}

/**
 * A stable key for a column. The bare column name is used when it is unique
 * across the schema, so simple single-table output is unchanged; a repeat is
 * qualified by its table so no entry is overwritten.
 */
function uniqueKey(seen: Map<string, string[]>, table: string, column: string): string {
  const taken = new Set(seen.keys())
  if (!taken.has(column)) {
    const count = countColumns(seen, column)
    if (count === 0) return column
    return `${table}_${column}`
  }
  return `${table}_${column}`
}

function countColumns(seen: Map<string, string[]>, column: string): number {
  let n = 0
  for (const k of seen.keys()) {
    if (k === column || k.endsWith(`_${column}`)) n++
  }
  return n
}

/**
 * Render a Map of key → chained calls as the body of a JavaScript object
 * literal, with every entry comma-separated so the result parses.
 */
function objectBody(entries: Map<string, string[]>, wrap = 'z.string()'): string {
  return [...entries.entries()]
    .map(([key, chain]) => `  ${JSON.stringify(key)}: ${wrap}${chain.join('')},`)
    .join('\n')
}

/**
 * Embed a regex as a `/.../` literal. Escaping `/` alone truncates any
 * character class that contains one (`[a-z0-9.!#$%&'*+/=?]`) and any
 * quantifier brace; `RegExp.prototype.source` already produces a
 * correctly-escaped body.
 */
function toRegexLiteral(pattern: string): string {
  return `/${new RegExp(pattern).source}/`
}

/**
 * Render one catalog sanitisation step. Steps are either a bare name
 * (`trim`, `slice(0, 254)`) or a parameterised object
 * (`{ normalize: NFKC }`). Both become a single string argument: the
 * `slice(0, 254)` form carries a comma inside its argument and must not be
 * split into two.
 */
function sanitizeStepLiteral(step: unknown): string {
  if (typeof step === 'string') return JSON.stringify(step)
  if (step && typeof step === 'object' && !Array.isArray(step)) {
    const [name, arg] = Object.entries(step as Record<string, unknown>)[0] ?? []
    if (name) return JSON.stringify(`${name}: ${String(arg ?? '')}`)
  }
  return JSON.stringify(String(step))
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

function generateRoutes(schema: SchemaInfo, fields: Array<{ table: string; column: ColumnInfo; type: CatalogType }>): string {
  const tableName = schema.tables[0]?.tableName ?? 'resource'
  const tableFields = fields.filter(f => f.table === tableName)

  // Build the zod schema inline so the module that validates a payload is the
  // same module that serves it. Previously this file imported `z` and
  // `sanitize`, used neither, and registered no routes at all.
  const validators = tableFields
    .map(({ column, type }) => {
      const tierConfig = type.tiers?.production ?? type.tiers?.prototype
      const parts: string[] = []
      if (tierConfig?.validation?.regex) parts.push(`.regex(${toRegexLiteral(tierConfig.validation.regex)})`)
      if (tierConfig?.validation?.maxLength) parts.push(`.max(${tierConfig.validation.maxLength})`)
      return parts.length > 0 ? `  ${JSON.stringify(column.columnName)}: z.string()${parts.join('')}` : ''
    })
    .filter(Boolean)

  const sanitizers = tableFields
    .filter(({ type }) => (type.tiers?.production ?? type.tiers?.prototype)?.sanitize?.length)
    .map(({ column, type }) => {
      const cfg = type.tiers?.production ?? type.tiers?.prototype
      const steps = (cfg?.sanitize ?? []).map(sanitizeStepLiteral).join(', ')
      return `  ${JSON.stringify(column.columnName)}: (v: unknown) => sanitize(String(v ?? ''), [${steps}])`
    })

  return `import { Router } from 'express'
import { z } from 'zod'
import { sanitize } from 'sure-factor/sanitize'

// Generated from sure-factor catalog. Table: ${tableName}

export const createSchema = z.object({
${validators.join(',\n') || '  // no catalog validators matched for this table'}
})

export const createSanitizer: Record<string, (v: unknown) => string> = {
${sanitizers.join(',\n') || '  // no catalog sanitisation steps matched for this table'}
}

export function sanitizeInput(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) {
    out[key] = createSanitizer[key] ? createSanitizer[key]!(value) : String(value ?? '')
  }
  return out
}

const router = Router()

router.get('/${tableName}', async (req, res) => {
  res.json({ ok: true, table: '${tableName}', items: [] })
})

router.post('/${tableName}', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ ok: false, errors: parsed.error.issues })
    return
  }
  res.json({ ok: true, table: '${tableName}', created: sanitizeInput(parsed.data as Record<string, unknown>) })
})

export default router`
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

function generateTemplate(component: CatalogComponent, fields: Array<{ table: string; column: ColumnInfo; type: CatalogType }>, options: GenerateOptions): string {
  const cc = component.cssClasses ?? {}
  const fClass = cc.field ?? 'field'
  const lClass = cc.label ?? 'field-label'
  const iClass = cc.input ?? 'field-input'
  const eClass = cc.error ?? 'field-error'
  const hClass = cc.help ?? 'field-help'

  const fieldHtml = fields.map(({ column, type }) => {
    const safeName = safeHandlebarKey(column.columnName)
    const attrName = htmlAttr(column.columnName)
    // An i18n expression is `{{i18n "key"}}` — the inner double quotes would
    // terminate the attribute they sit in, so the whole value is entity-escaped
    // and the template reads it back through the triple-stash.
    const label = `{{i18n &quot;types.${htmlAttr(type.name)}.label&quot;}}`
    const placeholder = `{{{i18n &quot;types.${htmlAttr(type.name)}.placeholder&quot;}}}`
    const help = `{{i18n &quot;types.${htmlAttr(type.name)}.help&quot;}}`
    const errorKey = `{{i18n &quot;types.${htmlAttr(type.name)}.error.format&quot;}}`
    const inputType = inputTypeForColumn(column)
    const inputAttrs = inputType === 'checkbox'
      ? `type="checkbox" id="${attrName}" name="${attrName}" class="${iClass}"`
      : `type="${inputType}" id="${attrName}" name="${attrName}" class="${iClass}" placeholder="${placeholder}" value="{{values.${safeName}}}"`
    return `
  <div class="${htmlAttr(fClass)}">
    <label class="${htmlAttr(lClass)}" for="${attrName}">${label}</label>
    <input ${inputAttrs} />
    {{#if errors.${safeName}}}
      <span class="${htmlAttr(eClass)}" role="alert">${errorKey}</span>
    {{else}}
      <span class="${htmlAttr(hClass)}">${help}</span>
    {{/if}}
  </div>`
  }).join('\n')

  const formClass = htmlAttr(cc.form ?? 'sure-form')
  return `
<form class="${formClass}" hx-post="/{{resource}}" hx-target="this" hx-swap="outerHTML" novalidate>
  ${fieldHtml}
  <button type="submit" class="btn-primary">{{i18n &quot;components.${htmlAttr(component.name)}.submitLabel&quot;}}</button>
</form>
`.trim()
}

function generateI18n(fields: Array<{ table: string; column: ColumnInfo; type: CatalogType }>, locale: string): Record<string, string> {
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

/** Does a declared script name resolve to a real file under catalog/assets? */
function scriptExists(name: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return false
  try {
    const url = new URL(`../catalog/assets/${name}`, import.meta.url)
    // Assets live in type subdirectories (audio/, i18n/, data/, themes/).
    for (const dir of ['', 'audio', 'i18n', 'data', 'themes']) {
      const candidate = new URL(dir ? `${dir}/${name}` : name, url)
      if (existsSync(candidate)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Keep only scripts that exist. The catalog declared names with no file behind
 * them, and the generator copied the list through unchecked, so a consumer
 * received imports that could not resolve.
 */
export function resolveComponentScripts(component: CatalogComponent): string[] {
  return (component.scripts ?? []).filter(scriptExists)
}

export function inspectComponentScripts(component: CatalogComponent): Array<{ name: string; exists: boolean }> {
  return (component.scripts ?? []).map((name) => ({ name, exists: scriptExists(name) }))
}

export function loadComponentScripts(componentName: string): Array<{ name: string; exists: boolean }> {
  const component = loadComponent(componentName)
  if (!component) return []
  return inspectComponentScripts(component)
}

/**
 * Emit declarations for the component's cssClasses. The previous output was a
 * single comment naming the theme, so a caller writing `styles` to disk got no
 * rules at all.
 */
function generateStyles(component: CatalogComponent, theme: string): string {
  const cc = component.cssClasses ?? {}
  const rules: string[] = [`/* Theme: ${theme} — generated by sure-factor for "${component.name}" */`]
  const role = (name: string, fallback: string) => cc[name] ?? fallback
  rules.push(
    `.${role('form', 'field-form')} { display: flex; flex-direction: column; gap: 0.75rem; }`,
    `.${role('field', 'field')} { display: flex; flex-direction: column; gap: 0.25rem; }`,
    `.${role('label', 'field-label')} { font-weight: 600; font-size: 0.875rem; }`,
    `.${role('input', 'field-input')} { padding: 0.5rem; border: 1px solid currentColor; border-radius: 4px; }`,
    `.${role('help', 'field-help')} { font-size: 0.8125rem; opacity: 0.75; }`,
    `.${role('error', 'field-error')} { font-size: 0.8125rem; color: #b00020; }`,
  )
  return rules.join('\n')
}