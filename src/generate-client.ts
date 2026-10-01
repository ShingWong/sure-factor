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
import { uniqueKey } from './generate-internal.js'
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
        sanitize: (type.sanitize?.input ?? []).map((s) =>
          typeof s === 'string' ? s : `${Object.entries(s as Record<string, unknown>)[0]?.[0] ?? ''}: ${String(Object.values(s as Record<string, unknown>)[0] ?? '')}`,
        ),
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
      if (!busy) options.onSubmit(values)
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

export function generateClientComponent(
  schema: SchemaInfo,
  options: ClientGenerateOptions,
): ClientComponentOutput {
  const component = loadComponent(options.component)
  if (!component) {
    throw new Error(`Component "${options.component}" not found in catalog`)
  }
  const fields = buildClientFields(schema, options, component)
  return {
    module: renderModule(component, fields, options),
    fields,
    cssClasses: { ...(component.cssClasses ?? {}) },
  }
}