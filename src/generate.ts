import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { join, dirname } from 'path'
import type { SchemaInfo, ColumnInfo } from './introspect.js'
import type { CatalogType, CatalogComponent } from './types.js'
import { matchColumnToTypeSync, loadAllTypesSync } from './match.js'
import { parseYaml } from './parse-yaml.js'
import { objectBody, sanitizeStepLiteral, toRegexLiteral, uniqueKey } from './generate-internal.js'
import { compose, type ComponentName } from '@shing.wong/sure-ui'

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
  /**
   * sure-ui's notifications runtime (showNotification/clearNotifications),
   * emitted ONLY when the component declares a non-inline notification mode
   * (toast/statusBar/sidePanel need it; pure-inline components don't). Null
   * means "your component needs no runtime" — write the string to disk as
   * notifications.js when present.
   */
  notifications: string | null
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
    notifications: notificationsRuntime(component),
    validation: objectBody(validationEntries),
    sanitization: objectBody(sanitizeEntries, ''),
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
    // Assets live in type subdirectories (audio/, i18n/, data/).
    for (const dir of ['', 'audio', 'i18n', 'data']) {
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
 * Emit the component's styles as sure-ui `compose()` output over the block
 * list the yaml declares in `sure_ui` — one token-driven theme, no hand-rolled
 * palette. The registry test keeps `sure_ui` honest against sure-ui's
 * COMPONENTS and against the template's hardcoded classes.
 *
 * Only the *template defaults* (the generic `field`/`field-label`/… class
 * names used when a yaml's cssClasses omits that role) get local rules here —
 * compose styles sure-ui classes, not these. The error rule uses the theme's
 * `--error-ink` token: a hardcoded colour pins the page to one palette.
 */
const TEMPLATE_DEFAULTS = { form: 'sure-form', field: 'field', label: 'field-label', input: 'field-input', error: 'field-error', help: 'field-help' } as const
const FALLBACK_RULES: Partial<Record<keyof typeof TEMPLATE_DEFAULTS, string>> = {
  form: 'display: flex; flex-direction: column; gap: 0.75rem;',
  field: 'display: flex; flex-direction: column; gap: 0.25rem;',
  label: 'font-weight: 600; font-size: 0.875rem;',
  input: 'padding: 0.5rem; border: 1px solid currentColor; border-radius: 4px;',
  help: 'font-size: 0.8125rem; opacity: 0.75;',
  error: 'font-size: 0.8125rem; color: var(--error-ink);',
}

function generateStyles(component: CatalogComponent, theme: string): string {
  const cc = component.cssClasses ?? {}
  const blocks = (component.sure_ui ?? []) as ComponentName[]
  const composed = compose({ theme, components: blocks })
  // A role the yaml maps to a sure-* class is styled by compose; only emit a
  // local rule for the class the template will actually render that compose
  // does not cover (generic defaults, catalog-private classes). The rules go
  // through compose's `extra` so they land INSIDE the components layer —
  // emitted after the layers they would be unlayered, and unlayered CSS
  // beats the theme regardless of specificity (the e2e caught exactly this:
  // an unlayered 4px override beating compose's 6px).
  const styledBy = (cls: string): boolean =>
    new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(composed)
  const fallbacks: string[] = []
  for (const [role, decl] of Object.entries(FALLBACK_RULES)) {
    const key = role as keyof typeof TEMPLATE_DEFAULTS
    const cls = cc[key] ?? TEMPLATE_DEFAULTS[key]
    if (!styledBy(cls)) fallbacks.push(`.${cls} { ${decl} }`)
  }
  const header = `/* Theme: ${theme} — sure-ui compose [${blocks.join(', ')}] for "${component.name}" */`
  const css = fallbacks.length > 0 ? compose({ theme, components: blocks, extra: fallbacks.join('\n') }) : composed
  return `${header}\n${css}`
}

/** sure-ui ships a self-contained notifications runtime (no imports). */
let notificationsSource: string | null = null
function loadNotificationsSource(): string {
  if (notificationsSource !== null) return notificationsSource
  const entry = createRequire(import.meta.url).resolve('@shing.wong/sure-ui')
  const runtime = join(dirname(entry), 'notifications.js')
  if (!existsSync(runtime)) {
    throw new Error(
      `notifications.js not found next to ${entry} — reinstall @shing.wong/sure-ui (its prepare script builds dist/)`,
    )
  }
  // drop the sourceMappingURL comment: the generated app ships no .map
  notificationsSource = readFileSync(runtime, 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/, '')
  return notificationsSource
}

/**
 * Emit the notifications runtime only for components that declare a
 * non-inline mode (toast/statusBar/sidePanel render through it). Pure-inline
 * components — and components with no modes at all — get null: writing the
 * runtime there would ship bytes nothing calls.
 */
function notificationsRuntime(component: CatalogComponent): string | null {
  const modes = component.behavior?.notificationModes ?? []
  return modes.some((m) => m !== 'inline') ? loadNotificationsSource() : null
}