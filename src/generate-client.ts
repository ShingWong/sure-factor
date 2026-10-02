/**
 * Client-target generation.
 *
 * `generateForTier` emits a server stack: Handlebars, htmx, express. The
 * management console is a client-side SPA and consumes none of that — it needs
 * DOM-building code. This module emits a self-contained ES module that renders
 * a FormSpec into real elements, so the generated class names stay tied to the
 * `cssClasses` contract in `catalog/components/*.yaml`.
 *
 * Deliberately framework-free: no React, no runtime dependency. The output is
 * an `h()`-based renderer plus a typed spec contract the caller fills from its
 * own server.
 */
import { existsSync, readFileSync } from 'fs'
import type { SchemaInfo, ColumnInfo } from './introspect.js'
import type { CatalogType, CatalogComponent } from './types.js'
import { matchColumnToTypeSync, loadAllTypesSync } from './match.js'
import { parseYaml } from './parse-yaml.js'
import { sanitizeStepList, uniqueKey } from './generate-internal.js'
import type { GenerationTier } from './generate.js'

export interface ClientGenerateOptions {
  tier: GenerationTier
  component: string
  /** Component export name, e.g. `UserCreateForm`. */
  exportName: string
}

export interface ClientFieldSpec {
  name: string
  label: string
  help: string
  required: boolean
  control: 'text' | 'password' | 'select' | 'textarea'
  type: string
  readOnly: boolean
  secret: boolean
  json: boolean
  validation: { regex: string | null; minLength: number | null; maxLength: number | null }
  hints: {
    placeholder?: string
    help?: string
    error?: { required?: string; format?: string; tooShort?: string; tooLong?: string }
  }
  sanitize: string[]
  source: { table: string; column: string } | null
}

export interface ClientComponentOutput {
  /** The ES module source. Parses and runs with no dependencies. */
  module: string
  /** The field specs, so a server can serialise them straight to the client. */
  fields: ClientFieldSpec[]
  cssClasses: Record<string, string>
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

function inputTypeForColumn(col: ColumnInfo): string {
  const dt = col.dataType.toLowerCase()
  if (dt === 'boolean') return 'checkbox'
  if (dt === 'date' || dt === 'timestamp' || dt === 'timestamptz') return 'date'
  if (['integer', 'bigint', 'smallint', 'serial', 'bigserial', 'numeric', 'decimal', 'real', 'double'].includes(dt)) return 'number'
  return 'text'
}

function controlFor(col: ColumnInfo, type: CatalogType): ClientFieldSpec['control'] {
  if (type.name === 'password') return 'password'
  if (/^(jsonb?|json)$/i.test(col.dataType)) return 'textarea'
  if (inputTypeForColumn(col) === 'checkbox') return 'text'
  return 'text'
}

/**
 * Derive the field specs the client renderer consumes. Keyed by table+column
 * for the same reason as the server target: a bare column name collides across
 * tables and silently drops validation.
 */
export function buildClientFields(
  schema: SchemaInfo,
  options: ClientGenerateOptions,
  component: CatalogComponent,
): ClientFieldSpec[] {
  const allTypes = loadAllTypesSync()
  const seen = new Map<string, string[]>()
  const out: ClientFieldSpec[] = []

  for (const table of schema.tables) {
    for (const column of table.columns) {
      const matched = matchColumnToTypeSync(column, allTypes, options.tier)
      if (!matched) continue
      const type = matched.type
      const tierConfig = type.tiers?.[options.tier]
      if (!tierConfig) continue

      const key = uniqueKey(seen, table.tableName, column.columnName)
      const validation = type.validation ?? {}
      const hints = type.hints?.en ?? {}
      const spec: ClientFieldSpec = {
        name: key,
        label: column.columnName.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        control: controlFor(column, type),
        type: type.name,
        required: !column.isNullable,
        readOnly: column.isPrimaryKey === true,
        secret: false,
        json: /^(jsonb?|json)$/i.test(column.dataType),
        validation: {
          regex: validation.regex ?? null,
          minLength: validation.minLength ?? null,
          maxLength: validation.maxLength ?? null,
        },
        sanitize: sanitizeStepList(type.sanitize?.input),
        // Mirrors the server-side FormSpec: help text and placeholder live
        // under \`hints\`, not at the top level.
        help: hints.help ?? '',
        hints: {
          placeholder: hints.placeholder ?? '',
          help: hints.help ?? '',
          error: hints.error ?? {},
        },
        source: { table: table.tableName, column: column.columnName },
      }
      seen.set(key, [column.columnName])
      out.push(spec)
    }
  }
  return out
}

/**
 * Emit the ES module. The renderer walks a FormSpec at runtime rather than
 * baking one form per call, so the same module serves every entity whose spec
 * arrives from the server.
 */
function renderModule(
  component: CatalogComponent,
  fields: ClientFieldSpec[],
  options: ClientGenerateOptions,
): string {
  const cc = component.cssClasses ?? {}
  const cls = (key: string, fallback: string): string => cc[key] ?? fallback
  const formClass = cls('form', 'sure-form')
  const fieldClass = cls('field', 'sure-form__field')
  const labelClass = cls('label', 'sure-form__label')
  const inputClass = cls('input', 'sure-form__input')
  const errorClass = cls('error', 'sure-form__error')
  const helpClass = cls('help', 'sure-form__help')
  const titleClass = cls('title', 'sure-form__title')
  const actionsClass = cls('actions', 'sure-form__actions')
  const submitClass = cls('submit', 'btn-primary')
  const cancelClass = cls('cancel', 'btn-secondary')

  return `// Generated by sure-factor from catalog/${component.name}.yaml.
// Component: ${component.name} — DOM renderer, no framework, no dependencies.
//
// The form is driven by a FormSpec supplied by the server, so one module
// renders every entity. Field names come from the catalog-matched columns of
// the schema this was generated against.

export interface FieldHints {
  placeholder?: string
  help?: string
  error?: { required?: string; format?: string; tooShort?: string; tooLong?: string }
}

export interface FieldSpec {
  name: string
  label: string
  help: string
  required: boolean
  control: 'text' | 'password' | 'select' | 'textarea' | 'hidden'
  type: string
  options?: string[]
  readOnly?: boolean
  secret?: boolean
  json?: boolean
  validation: { regex?: string | null; minLength?: number | null; maxLength?: number | null }
  hints: FieldHints
  sanitize: string[]
  source: { table: string; column: string } | null
}

export interface FormSpec {
  id: string
  title: string
  fields: FieldSpec[]
}

/** Minimal element factory. Children may be nodes, strings, or nested arrays. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  ...children: Array<Node | string | null | undefined | Array<Node | string | null | undefined>>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue
      if (key === 'class') el.className = String(value)
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      } else if (value === true) el.setAttribute(key, '')
      else el.setAttribute(key, String(value))
    }
  }
  const add = (child: Node | string | null | undefined | Array<Node | string | null | undefined>): void => {
    if (child === null || child === undefined) return
    if (Array.isArray(child)) {
      for (const c of child) add(c)
      return
    }
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  for (const child of children) add(child)
  return el
}

function fieldId(name: string): string {
  return \`field-\${name}\`
}

/** One labelled control plus its help and error text. */
export function renderField(
  field: FieldSpec,
  value: string,
  error: string | undefined,
  busy: boolean,
  onChange: (name: string, value: string) => void,
): HTMLElement {
  const id = fieldId(field.name)
  const describedBy = error ? \`\${id}-error\` : field.help ? \`\${id}-help\` : undefined

  const common: Record<string, unknown> = {
    id,
    name: field.name,
    value: field.control === 'select' ? value || (field.options?.[0] ?? '') : value,
    required: field.required,
    disabled: field.readOnly === true || busy,
    readOnly: field.readOnly === true,
    autocomplete: field.control === 'password' ? 'new-password' : 'off',
    'aria-invalid': error ? 'true' : 'false',
    'aria-describedby': describedBy,
    placeholder: field.hints?.placeholder ?? '',
    minlength: field.validation?.minLength ?? undefined,
    maxlength: field.control === 'textarea' ? undefined : (field.validation?.maxLength ?? undefined),
    oninput: (e: Event) => onChange(field.name, (e.target as HTMLInputElement).value),
  }

  let control: HTMLElement
  if (field.control === 'select') {
    const select = h('select', common)
    if (!field.required) {
      const blank = h('option', { value: '' }, '\\u2014')
      select.appendChild(blank)
    }
    for (const opt of field.options ?? []) {
      select.appendChild(h('option', { value: opt }, opt))
    }
    control = select
  } else if (field.control === 'textarea') {
    control = h('textarea', { ...common, rows: 5, spellcheck: 'false' })
  } else {
    const type = field.control === 'password' ? 'password' : (field.type === 'email' ? 'email' : 'text')
    control = h('input', { ...common, type })
  }

  const label = h('label', { class: ${JSON.stringify(labelClass)}, for: id }, field.label)
  if (field.required) label.appendChild(h('span', { 'aria-hidden': 'true' }, ' *'))

  const parts: HTMLElement[] = [label, control]
  if (field.help || field.hints?.help) {
    parts.push(
      h('div', { class: ${JSON.stringify(helpClass)}, id: \`\${id}-help\` },
        [field.help, field.hints?.help].filter(Boolean).join(' \\u2014 ')),
    )
  }
  if (error) {
    parts.push(h('div', { class: ${JSON.stringify(errorClass)}, id: \`\${id}-error\`, role: 'alert' }, error))
  }
  return h('div', { class: ${JSON.stringify(fieldClass)} }, ...parts)
}

export interface FormOptions {
  values?: Record<string, string>
  errors?: Record<string, string>
  busy?: boolean
  submitLabel?: string
  onChange: (name: string, value: string) => void
  onSubmit: (values: Record<string, string>) => void
  onCancel?: () => void
  /** Called instead of onSubmit when the values fail validation. */
  onInvalid?: (errors: Record<string, string>) => void
  /** Set false to submit without validating — e.g. for a draft save. */
  validate?: boolean
}

/**
 * Validate a form's values against its spec.
 *
 * The catalog carries the rules (required, regex, min/max length, JSON), and
 * every consumer had been re-implementing this — the management console kept
 * its own copy in formspec.ts. Rules live in the generated module so they
 * cannot drift from the fields they describe.
 *
 * Returns field name → message; an empty object means valid. Never throws: a
 * malformed regex in the catalog is treated as "no constraint" rather than
 * failing the form.
 */
export function validateForm(
  spec: FormSpec,
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of spec.fields) {
    if (field.control === 'hidden') continue
    const value = values[field.name] ?? ''
    const v = field.validation ?? {}

    if (field.required && value.trim() === '') {
      errors[field.name] = field.hints?.error?.required ?? \`\${field.label} is required\`
      continue
    }
    if (value === '') continue

    if (field.json) {
      try {
        JSON.parse(value)
      } catch {
        errors[field.name] = 'must be valid JSON'
        continue
      }
    }

    if (v.regex) {
      let ok = true
      try {
        ok = new RegExp(v.regex, 'u').test(value)
      } catch {
        ok = true
      }
      if (!ok) {
        errors[field.name] = field.hints?.error?.format ?? \`\${field.label} has an invalid format\`
        continue
      }
    }

    if (v.minLength != null && value.length < v.minLength) {
      errors[field.name] =
        field.hints?.error?.tooShort ?? \`\${field.label} must be at least \${v.minLength} characters\`
      continue
    }
    if (v.maxLength != null && field.control !== 'textarea' && value.length > v.maxLength) {
      errors[field.name] =
        field.hints?.error?.tooLong ?? \`\${field.label} must be at most \${v.maxLength} characters\`
    }
  }
  return errors
}

/**
 * Sanitise values using each field's catalog sanitisation steps.
 *
 * The steps come from the FormSpec, so they are the same ones the server
 * applies. An unknown step is skipped rather than throwing, and a field with
 * none declared still gets trimmed.
 */
export function sanitizeForm(
  spec: FormSpec,
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of spec.fields) {
    if (field.control === 'hidden') {
      out[field.name] = values[field.name] ?? ''
      continue
    }
    let value = values[field.name] ?? ''
    // maxLength bounds the stored value; \`slice\` in the catalog's own recipe
    // does too, but only where the recipe asks for it. A textarea is exempt so
    // a long entry is not silently truncated.
    for (const step of field.sanitize?.length ? field.sanitize : ['trim']) {
      value = applyStep(value, step)
    }
    const max = v_max(field)
    if (max && field.control !== 'textarea') {
      value = value.slice(0, max)
    }
    out[field.name] = value
  }
  return out
}

/**
 * One sanitisation step, duplicated here rather than imported so the generated
 * module stays dependency-free. A step it does not know is a no-op: the
 * catalog may name one a future version adds, and that should not blank a
 * user's input.
 */
function applyStep(value: string, step: string): string {
  const call = step.match(/^(\\w+)\\(([^)]*)\\)$/)
  if (call) {
    const args = call[2].split(',').map((a) => a.trim()).filter(Boolean)
    switch (call[1]) {
      case 'normalize': return value.normalize(args[0] ?? 'NFKC')
      case 'slice': return value.slice(Number(args[0] ?? 0), args[1] !== undefined ? Number(args[1]) : undefined)
      default: break
    }
  }
  switch (step) {
    case 'trim': return value.trim()
    case 'lowercase': return value.toLowerCase()
    case 'uppercase': return value.toUpperCase()
    case 'htmlEscape': return value
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#x2F;')
    case 'stripNonDigits': return value.replace(/\\D/g, '')
    case 'collapseWhitespace': return value.replace(/\\s+/g, ' ').trim()
    case 'stripControl': return value.replace(/[\\u0000-\\u001F\\u007F-\\u009F]/g, '')
    case 'stripDirectionOverrides': return value.replace(/[\\u202A-\\u202E\\u2066-\\u2069]/g, '')
    case 'stripZeroWidth': return value.replace(/[\\u200B-\\u200D\\uFEFF]/g, '')
    default: return value
  }
}

function v_max(field: { validation?: { maxLength?: number | null } }): number | null {
  const n = field.validation?.maxLength
  return typeof n === 'number' && n > 0 ? n : null
}

/** Render a FormSpec into a form element wired to the supplied callbacks. */
export function renderForm(spec: FormSpec, options: FormOptions): HTMLFormElement {
  const values = options.values ?? {}
  const errors = options.errors ?? {}
  const busy = options.busy ?? false

  const visible = spec.fields.filter((f) => f.control !== 'hidden')
  const form = h('form', {
    class: ${JSON.stringify(formClass)},
    'aria-label': spec.title,
    novalidate: true,
    onsubmit: (e: Event) => {
      e.preventDefault()
      if (busy) return
      if (options.validate === false) {
        options.onSubmit(values)
        return
      }
      // Validate before handing anything over. The rules come from the catalog
      // via the spec, so a malformed value never leaves the browser.
      const found = validateForm(spec, values)
      if (Object.keys(found).length === 0) {
        options.onSubmit(sanitizeForm(spec, values))
        return
      }
      // Tell the caller what is wrong; it owns the render loop and decides how
      // to show it.
      if (options.onInvalid) options.onInvalid(found)
      else options.onSubmit(values)
    },
  })

  form.appendChild(h('h2', { class: ${JSON.stringify(titleClass)} }, spec.title))
  for (const field of visible) {
    form.appendChild(renderField(field, values[field.name] ?? '', errors[field.name], busy, options.onChange))
  }

  const actions = h('div', { class: ${JSON.stringify(actionsClass)} })
  actions.appendChild(h('button', { class: ${JSON.stringify(submitClass)}, type: 'submit', disabled: busy },
    options.submitLabel ?? 'Save'))
  if (options.onCancel) {
    actions.appendChild(h('button', {
      class: ${JSON.stringify(cancelClass)},
      type: 'button',
      disabled: busy,
      onclick: () => options.onCancel?.(),
    }, 'Cancel'))
  }
  form.appendChild(actions)
  return form
}

/** The fields this module was generated for, for a server to fill a spec from. */
export const GENERATED_FIELDS: FieldSpec[] = ${JSON.stringify(fields, null, 2)}

export const CSS_CLASSES = ${JSON.stringify({ ...cc }, null, 2)} as const

export default renderForm
`
}

/**
 * A component is rendered as a table when its catalog entry declares table
 * classes. Without this every component would get the same form renderer —
 * asking for `data-table` produced a form module with `sure-table` class names
 * on it.
 */
function isTableComponent(component: CatalogComponent): boolean {
  const cc = component.cssClasses ?? {}
  return typeof cc.row === 'string' || typeof cc.cell === 'string' || typeof cc.header === 'string'
}

/**
 * The table renderer. Shares the element factory with the form module, but
 * emits `<table>` markup and a column renderer rather than labelled controls.
 */
function renderTableModule(component: CatalogComponent, fields: ClientFieldSpec[]): string {
  const cc = component.cssClasses ?? {}
  const cls = (key: string, fallback: string): string => cc[key] ?? fallback
  const tableClass = cls('form', 'sure-table')
  const headerClass = cls('header', cls('label', 'sure-table__header'))
  const cellClass = cls('cell', cls('field', 'sure-table__cell'))
  const rowClass = cc.row ?? ''
  const errorClass = cls('error', 'sure-table__error')

  return `// Generated by sure-factor from catalog/${component.name}.yaml.
// Component: ${component.name} — DOM table renderer, no framework.
//
// Columns are derived from the catalog-matched columns of the schema this was
// generated against. Pass rows as plain objects keyed by field name.

export interface ColumnSpec {
  /** Field name, used to read the value off each row. */
  name: string
  label: string
  /** Rendered instead of the raw value when the row has no such key. */
  emptyText?: string
}

export interface TableOptions {
  columns?: ColumnSpec[]
  rows: Array<Record<string, unknown>>
  emptyText?: string
  selectedId?: string | null
  onRowClick?: (row: Record<string, unknown>) => void
  /** Row identity; defaults to \`id\`. */
  idKey?: string
}

/** Minimal element factory. Children may be nodes, strings, or nested arrays. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  ...children: Array<Node | string | null | undefined | Array<Node | string | null | undefined>>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue
      if (key === 'class') el.className = String(value)
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      } else if (value === true) el.setAttribute(key, '')
      else el.setAttribute(key, String(value))
    }
  }
  const add = (child: Node | string | null | undefined | Array<Node | string | null | undefined>): void => {
    if (child === null || child === undefined) return
    if (Array.isArray(child)) {
      for (const c of child) add(c)
      return
    }
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  for (const child of children) add(child)
  return el
}

/**
 * A cell value may be a plain value (rendered as text), an array (joined), or
 * a Node (appended as-is). Accepting Nodes matters because status badges and
 * action buttons are elements, and stringifying one would put
 * "[object HTMLElement]" in the table.
 */
function appendCell(td: HTMLElement, value: unknown, emptyText: string): void {
  if (value === null || value === undefined || value === '') {
    td.appendChild(document.createTextNode(emptyText))
    return
  }
  if (Array.isArray(value)) {
    const text = value.length > 0 ? value.join(', ') : emptyText
    td.appendChild(document.createTextNode(text))
    return
  }
  if (typeof value === 'object' && 'nodeType' in (value as Node)) {
    td.appendChild(value as Node)
    return
  }
  td.appendChild(document.createTextNode(String(value)))
}

export function renderTable(options: TableOptions): HTMLElement {
  const columns: ColumnSpec[] = options.columns ?? GENERATED_COLUMNS
  const idKey = options.idKey ?? 'id'

  if (options.rows.length === 0) {
    return h('p', { class: ${JSON.stringify(errorClass)}, role: 'status' },
      options.emptyText ?? 'Nothing here yet.')
  }

  const head = h('tr', null,
    ...columns.map((c) => h('th', { class: ${JSON.stringify(headerClass)}, scope: 'col' }, c.label)),
  )

  const body = h('tbody', null,
    ...options.rows.map((row) => {
      const rowId = String(row[idKey] ?? '')
      const selected = options.selectedId != null && rowId === String(options.selectedId)
      const tr = h('tr', {
        class: ${JSON.stringify(rowClass)} + (selected ? ' is-selected' : ''),
        'aria-selected': selected ? 'true' : undefined,
        onclick: options.onRowClick ? () => options.onRowClick?.(row) : undefined,
        style: { cursor: options.onRowClick ? 'pointer' : '' },
      },
        ...columns.map((c) => {
          const td = h('td', { class: ${JSON.stringify(cellClass)} })
          appendCell(td, row[c.name], c.emptyText ?? '\\u2014')
          return td
        }),
      )
      return tr
    }),
  )

  return h('table', { class: ${JSON.stringify(tableClass)} }, h('thead', null, head), body)
}

/** The columns this module was generated for. */
export const GENERATED_COLUMNS: ColumnSpec[] = ${JSON.stringify(
    fields.map((f) => ({ name: f.name, label: f.label, emptyText: '\\u2014' })),
    null,
    2,
  )}

export const GENERATED_FIELDS = ${JSON.stringify(fields, null, 2)}

export const CSS_CLASSES = ${JSON.stringify({ ...cc }, null, 2)} as const

export default renderTable
`
}

export function generateClientComponent(
  schema: SchemaInfo,
  options: ClientGenerateOptions,
): ClientComponentOutput {
  const component = loadComponent(options.component)
  if (!component) {
    throw new Error(`Component "${options.component}" not found in catalog`)
  }
  const fields = buildClientFields(schema, options, component)
  const module = isTableComponent(component)
    ? renderTableModule(component, fields)
    : renderModule(component, fields, options)
  return {
    module,
    fields,
    cssClasses: { ...(component.cssClasses ?? {}) },
  }
}