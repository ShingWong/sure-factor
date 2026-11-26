import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { join, dirname } from 'path'
import type { SchemaInfo, ColumnInfo } from './introspect.js'
import type { CatalogType, CatalogComponent } from './types.js'
import { matchColumnToTypeSync, loadAllTypesSync } from './match.js'
import { parseYaml } from './parse-yaml.js'
import { objectBody, sanitizeStepLiteral, toRegexLiteral, uniqueKey } from './generate-internal.js'
import { assertValidDocumentPart, isDocumentPart } from './catalog.js'
import { compose, type ComponentName } from '@shing.wong/sure-ui'

export type GenerationTier = 'vibe' | 'prototype' | 'production'

export interface GenerateOptions {
  tier: GenerationTier
  component: string
  locale?: string
  theme?: string
  /**
   * The one table this call generates. Fields, routes, i18n, validation and
   * sanitisation are all scoped to it — a multi-table schema is generated one
   * resource per call, never merged into a single form or table.
   *
   * Omitted: the first table in the schema is used (the table the routes have
   * always targeted). Existing single-table callers therefore keep working;
   * a multi-table caller must pass this option once per table. `resource` is
   * accepted as an alias for callers that speak in terms of a resource.
   */
  tableName?: string
  resource?: string
  /**
   * A caller-supplied catalog definition, e.g. a report entry parsed from
   * sure-store/components/*.yaml. When absent, `component` is loaded from
   * this package's catalog. Document parts can only be generated through this
   * option because sure-store owns their YAML, not sure-factor.
   */
  componentDefinition?: CatalogComponent
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
  const { tier } = options

  const component = options.componentDefinition ?? loadComponent(options.component)
  if (!component) {
    throw new Error(`Component "${options.component}" not found in catalog`)
  }
  // Document parts carry their own validation; an invalid guard must fail
  // here too, rather than being emitted as markup nobody can verify.
  if (isDocumentPart(component)) assertValidDocumentPart(component)

  const tableName = resolveTableName(schema, options)
  const allTypes = loadAllTypesSync()
  // One resource per call. Keeping the owning table on each field still
  // matters: a repeated column name must not collide with another entry.
  const fields: ScopedField[] = []
  for (const table of schema.tables) {
    if (table.tableName !== tableName) continue
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
    routes: generateRoutes(fields, tableName),
    template: generateTemplate(component, fields, options, tableName),
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

/**
 * Resolve the single resource this call generates. Defaulting to the first
 * table keeps the historical behaviour for the common (single-table) call;
 * a multi-table caller must name its table explicitly instead of receiving
 * every table flattened into one form.
 */
function resolveTableName(schema: SchemaInfo, options: GenerateOptions): string {
  const { tableName, resource } = options
  if (tableName !== undefined && resource !== undefined && tableName !== resource) {
    throw new Error(`Conflicting resource selection: tableName="${tableName}" but resource="${resource}"`)
  }
  const name = tableName ?? resource ?? schema.tables[0]?.tableName
  if (name === undefined) return 'resource' // empty schema: keep the old placeholder
  if (!schema.tables.some((t) => t.tableName === name)) {
    const available = schema.tables.map((t) => t.tableName).join(', ') || '(none)'
    throw new Error(`Table "${name}" not found in schema; available tables: ${available}`)
  }
  return name
}

function generateRoutes(fields: ScopedField[], tableName: string): string {
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

/** A column matched to a catalog type, scoped to one table (the resource). */
type ScopedField = { table: string; column: ColumnInfo; type: CatalogType }

/**
 * Dispatch on what the catalog entry actually is. A report entry is a
 * document part, not a form; a data-table gets a real table. Everything else
 * keeps the htmx/express form contract. All three paths render the same
 * single resource.
 */
function generateTemplate(component: CatalogComponent, fields: ScopedField[], options: GenerateOptions, tableName: string): string {
  if (isDocumentPart(component)) return generateDocumentTemplate(component, fields, tableName)
  if (isTableComponent(component)) return generateTableTemplate(component, fields, tableName)
  return generateFormTemplate(component, fields)
}

/** True when the catalog entry declares the BEM roles of a table. Mirrors the
 *  client target's test so both targets classify the same components alike. */
function isTableComponent(component: CatalogComponent): boolean {
  const cc = component.cssClasses ?? {}
  return typeof cc.row === 'string' || typeof cc.cell === 'string' || typeof cc.header === 'string'
}

function generateFormTemplate(component: CatalogComponent, fields: ScopedField[]): string {
  const cc = component.cssClasses ?? {}
  const fClass = htmlAttr(cc.field ?? 'field')
  const lClass = htmlAttr(cc.label ?? 'field-label')
  const iClass = htmlAttr(cc.input ?? 'field-input')
  const eClass = htmlAttr(cc.error ?? 'field-error')
  const hClass = htmlAttr(cc.help ?? 'field-help')

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

  const formClass = htmlAttr(cc.form ?? 'sure-form')
  return `
<form class="${formClass}" hx-post="/{{resource}}" hx-target="this" hx-swap="outerHTML" novalidate>
  ${fieldHtml}
  <button type="submit" class="btn-primary">{{i18n &quot;components.${htmlAttr(component.name)}.submitLabel&quot;}}</button>
</form>
`.trim()
}

/**
 * The server-side data-table: real `<table>` markup, never a form of inputs.
 * Headers come from the matched columns of the one resource; rows come from
 * the handler's `rows` collection. Classes come from the catalog's cssClasses
 * (the sure-ui BEM names) and fall back to the sure-ui table roles.
 */
function generateTableTemplate(component: CatalogComponent, fields: ScopedField[], tableName: string): string {
  const cc = component.cssClasses ?? {}
  const tableClass = htmlAttr(cc.form ?? 'sure-table')
  const headerClass = htmlAttr(cc.header ?? cc.label ?? 'sure-table__header')
  const cellClass = htmlAttr(cc.cell ?? cc.field ?? 'sure-table__cell')
  const rowClass = htmlAttr(cc.row ?? 'sure-table__row')
  const emptyClass = htmlAttr(cc.error ?? 'sure-table__error')

  const headers = fields.map(({ type }) =>
    `      <th class="${headerClass}" scope="col">{{i18n &quot;types.${htmlAttr(type.name)}.label&quot;}}</th>`,
  ).join('\n') || `      <!-- no catalog-matched columns for ${htmlAttr(tableName)} -->`
  const cells = fields.map(({ column }) =>
    `        <td class="${cellClass}">{{this.${safeHandlebarKey(column.columnName)}}}</td>`,
  ).join('\n')

  return `
<table class="${tableClass}" data-resource="${htmlAttr(tableName)}">
  <thead>
    <tr>
${headers}
    </tr>
  </thead>
  <tbody>
    {{#each rows}}
    <tr class="${rowClass}">
${cells}
    </tr>
    {{else}}
    <tr><td class="${emptyClass}" colspan="${fields.length || 1}" role="status">{{i18n &quot;components.${htmlAttr(component.name)}.emptyLabel&quot;}}</td></tr>
    {{/each}}
  </tbody>
</table>
`.trim()
}

/**
 * A document part is emitted as its own markup: a sure-ui document section
 * wrapping either a figure (family `figure`) or a table of the declared
 * projection. No `<form>`, no submit button — and no `sure-form` class. The
 * report's guard/projection contract stays with `generateReportModule`; here
 * the projection is the set of columns the markup may bind.
 */
function generateDocumentTemplate(component: CatalogComponent, fields: ScopedField[], tableName: string): string {
  // Keep the guard local too: a direct call to the dispatcher cannot bypass
  // the document-part validation applied in generateForTier.
  assertValidDocumentPart(component)
  const cc = component.cssClasses ?? {}
  const family = component.family ?? 'structure'
  const shape = component.data?.shape ?? 'none'
  const projection = component.data?.projection ?? []
  const names = (projection.length > 0 ? projection : fields.map(f => f.column.columnName)).map(safeHandlebarKey)
  const rows = shape === 'rows' || shape === 'series'
  const binding = rows ? 'this' : 'record'
  const sectionClass = [
    'sure-document__section',
    component.print?.breakBefore ? 'sure-document__section--break-before' : '',
  ].filter(Boolean).join(' ')
  const attrs = [
    `data-document-part="${htmlAttr(component.name)}"`,
    `data-family="${htmlAttr(family)}"`,
    `data-shape="${htmlAttr(shape)}"`,
    `data-resource="${htmlAttr(tableName)}"`,
    `data-projection="${htmlAttr(projection.join(' '))}"`,
  ].join(' ')

  let body: string
  if (family === 'figure') {
    const graphicClass = htmlAttr(cc.graphic ?? 'sure-document__graphic')
    const plotClass = htmlAttr(cc.plot ?? 'sure-figure__plot')
    const caption = names[0] ? `{{${binding}.${names[0]}}}` : ''
    body = `<figure class="sure-figure">
    <div class="${graphicClass}"><div class="${plotClass}">{{{figure}}}</div></div>
    <figcaption class="sure-figure__legend">${caption}</figcaption>
  </figure>`
  } else {
    const tableClass = [cc.table ?? 'sure-table', cc.print, cc.total]
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .map((value) => htmlAttr(value)).join(' ')
    const headerClass = htmlAttr(cc.header ?? 'sure-table__header')
    const cellClass = htmlAttr(cc.cell ?? 'sure-table__cell')
    const rowClass = htmlAttr(cc.row ?? 'sure-table__row')
    const headers = names.map((name) =>
      `        <th class="${headerClass}" scope="col">${htmlAttr(name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))}</th>`,
    ).join('\n')
    const cells = names.map((name) =>
      `        <td class="${cellClass}">{{${binding}.${name}}}</td>`,
    ).join('\n')
    const row = `      <tr class="${rowClass}">\n${cells}\n      </tr>`
    // A row shape iterates the rows collection; a record shape reads the
    // single record from the handler's context. No #with here: the binding
    // prefix already names the scope.
    const tbody = rows ? `    {{#each rows}}\n${row}\n    {{/each}}` : row
    body = `<table class="${tableClass}">
      <thead>
        <tr>
${headers}
        </tr>
      </thead>
      <tbody>
${tbody}
      </tbody>
    </table>`
  }

  return `<section class="sure-document ${sectionClass}" ${attrs}>
  ${body}
</section>`
}

function generateI18n(fields: ScopedField[], locale: string): Record<string, string> {
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