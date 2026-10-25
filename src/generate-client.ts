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
  /** Section the field belongs to, when the schema declares one. */
  group?: string | null
  required: boolean
  control: 'text' | 'password' | 'select' | 'textarea'
  /** HTML input type, derived from the column's SQL type and catalog type. */
  inputType: 'text' | 'email' | 'number' | 'date' | 'password' | 'tel'
  type: string
  options?: string[]
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

function inputTypeForColumn(col: ColumnInfo, type: CatalogType): ClientFieldSpec['inputType'] {
  if (type.name === 'password') return 'password'
  if (type.name === 'email') return 'email'
  // Phone numbers are text input with a tel keyboard, never a spinner.
  if (type.name === 'us-phone' || type.name === 'intl-phone') return 'tel'

  const dt = col.dataType.toLowerCase()
  if (dt === 'date') return 'date'
  // Precision-qualified spellings (`NUMERIC(12,2)`) reach here unchanged, so
  // match the family rather than an exact list.
  if (/^(?:integer|bigint|smallint|tinyint|serial|bigserial|numeric|decimal|real|double)\b/.test(dt)) return 'number'
  return 'text'
}

function controlFor(col: ColumnInfo, type: CatalogType): ClientFieldSpec['control'] {
  if (type.name === 'password') return 'password'
  if (/^(jsonb?|json)$/i.test(col.dataType)) return 'textarea'
  // A CHECK (x IN (…)) constraint is an enumeration: render a select.
  if (col.enumValues && col.enumValues.length > 0) return 'select'
  return 'text'
}

/**
 * Split a `COMMENT ON COLUMN` into label and help.
 *
 * Convention: the first line is the label a person should read, anything after
 * it is help. A comment with no label line is ignored, so `comment` never
 * becomes an accidental label.
 */
function labelFromComment(comment: string | null | undefined): { label: string | null; help: string | null } {
  if (!comment) return { label: null, help: null }
  const lines = comment.split('\n').map((line) => line.trim())
  const label = lines[0] && lines[0] !== '' ? lines[0] : null
  // A `group:` line is metadata for the layout, not prose for the reader.
  const help = lines.slice(1).filter((line) => line !== '' && !/^group\s*:/i.test(line)).join(' ').trim()
  return { label, help: help === '' ? null : help }
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
      const fromComment = labelFromComment(column.comment)
      const help = [fromComment.help, hints.help ?? ''].filter(Boolean).join(' — ')
      const spec: ClientFieldSpec = {
        name: key,
        // A column comment is the DDL's own words for the field; fall back to
        // the mechanical snake_case → Sentence case derivation.
        label: fromComment.label ?? column.columnName.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        group: column.group ?? null,
        control: controlFor(column, type),
        inputType: inputTypeForColumn(column, type),
        type: type.name,
        ...(column.enumValues && column.enumValues.length > 0 ? { options: [...column.enumValues] } : {}),
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
        help,
        hints: {
          placeholder: hints.placeholder ?? '',
          help,
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
/** Catalog components that render a menu of caller-supplied items. */
function isMenuComponent(component: CatalogComponent): boolean {
  const params = (component as { parameters?: Record<string, unknown> }).parameters
  return component.name === 'horizontal-icon-menu' || (params !== undefined && 'items' in params)
}

/**
 * The menu module: a dependency-free renderer for a horizontal icon menu.
 *
 * Items come from the caller (id, icon or label, title, href, active), because a
 * menu is application chrome — there is no table to derive it from. Everything
 * else (classes, structure, active state) comes from the catalog entry.
 */
function renderMenuModule(component: CatalogComponent): string {
  const cc = component.cssClasses ?? {}
  const cls = (key: string, fallback: string): string => cc[key] ?? fallback
  const menuClass = cls('menu', 'sure-menu')
  const itemClass = cls('item', 'sure-menu__item')
  const activeClass = cls('active', 'active')
  const dividerClass = cls('divider', 'sure-menu__divider')

  return `// Generated by sure-factor from catalog/${component.name}.yaml.
// Component: ${component.name} — menu renderer, no framework, no dependencies.
//
// Items are supplied by the application: a menu is chrome, not a table.

export interface MenuItem {
  /** Stable id, passed back to onSelect. */
  id: string
  /** Visible text. Used alone when no icon is given. */
  label: string
  /**
   * Optional icon, rendered instead of the label: an inline SVG (coloured by
   * currentColor, so it follows the theme) or a plain character.
   */
  icon?: string
  /** Tooltip and accessible name; defaults to the label. */
  title?: string
  /** Renders an anchor instead of a button. */
  href?: string
  /** The current page. */
  active?: boolean
  /** A separator before this item. */
  dividerBefore?: boolean
  /**
   * Pin this item to the far end of the bar, away from the pages before it.
   * Use it for account-level actions (sign out) that belong at the edge.
   */
  align?: 'start' | 'end'
}

export interface MenuOptions {
  items: MenuItem[]
  /** Alignment within the bar. Defaults to right, as a toolbar menu. */
  position?: 'left' | 'center' | 'right'
  /** Accessible name for the nav landmark. */
  label?: string
  onSelect?: (item: MenuItem, event: Event) => void
}

export const CSS_CLASSES = ${JSON.stringify(component.cssClasses ?? {}, null, 2)}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, unknown> = {},
  ...children: Array<string | Node>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      continue
    }
    if (key === 'class') el.className = String(value)
    else if (key === 'dataset') Object.assign(el.dataset, value as Record<string, string>)
    else if (value === true) el.setAttribute(key, '')
    else el.setAttribute(key, String(value))
  }
  for (const child of children) el.append(typeof child === 'string' ? document.createTextNode(child) : child)
  return el
}

export function renderMenu(options: MenuOptions): HTMLElement {
  const justify = options.position === 'left' ? 'flex-start' : options.position === 'center' ? 'center' : 'flex-end'
  const nav = h('nav', {
    class: ${JSON.stringify(menuClass)},
    style: \`justify-content: \${justify}\`,
    'aria-label': options.label ?? 'Menu',
  })

  for (const item of options.items) {
    // An end-aligned item takes the auto margin itself; when a divider sits
    // before it, the divider carries the margin so the two travel together
    // instead of leaving the divider stranded with the pages on the left.
    const pinned = item.align === 'end'
    if (item.dividerBefore) {
      nav.appendChild(h('span', {
        class: ${JSON.stringify(dividerClass)},
        role: 'separator',
        'aria-orientation': 'vertical',
        ...(pinned ? { style: 'margin-inline-start:auto' } : {}),
      }))
    }
    const classes = [${JSON.stringify(itemClass)}, item.active ? ${JSON.stringify(activeClass)} : ''].filter(Boolean).join(' ')
    const attrs = {
      class: classes,
      ...(pinned && !item.dividerBefore ? { style: 'margin-inline-start:auto' } : {}),
      title: item.title ?? item.label,
      'aria-label': item.title ?? item.label,
      'data-item': item.id,
      ...(item.active ? { 'aria-current': 'page' } : {}),
      ...(item.href ? { href: item.href } : { type: 'button' }),
    }
    const iconIsSvg = typeof item.icon === 'string' && item.icon.trim().startsWith('<svg')
    const label = item.icon ?? item.label
    const control = item.href
      ? h('a', attrs, label)
      : h('button', attrs, label)
    if (iconIsSvg) {
      // An inline SVG inherits the theme through currentColor — emoji do not,
      // which is why a coloured glyph looks wrong in a business toolbar.
      control.innerHTML = item.icon!
      const svg = control.firstElementChild
      if (svg) {
        svg.setAttribute('aria-hidden', 'true')
        svg.setAttribute('focusable', 'false')
        svg.setAttribute('width', '1.15em')
        svg.setAttribute('height', '1.15em')
        svg.setAttribute('style', 'display:block')
      }
    }
    if (options.onSelect) {
      control.addEventListener('click', (event) => options.onSelect?.(item, event))
    }
    nav.appendChild(control)
  }

  return nav
}

export default renderMenu
`
}

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
  const messageClass = cls('message', 'sure-form__message')
  const titleClass = cls('title', 'sure-form__title')
  const groupClass = cls('group', 'sure-form__group')
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
  /** Section heading this field belongs to, when the schema declares one. */
  group?: string | null
  required: boolean
  control: 'text' | 'password' | 'select' | 'textarea' | 'hidden'
  /** HTML input type when the control is a text or password input. */
  inputType?: 'text' | 'email' | 'number' | 'date' | 'password' | 'tel'
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
    class: ${JSON.stringify(inputClass)},
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
    // The HTML input type comes from the column's SQL type and catalog type,
    // so a money column is a number input and a date is a date picker rather
    // than a text box the browser cannot help with.
    const type = field.control === 'password' ? 'password' : (field.inputType ?? 'text')
    control = h('input', { ...common, type })
  }

  const label = h('label', { class: ${JSON.stringify(labelClass)}, for: id }, field.label)
  if (field.required) label.appendChild(h('span', { 'aria-hidden': 'true' }, ' *'))

  const parts: HTMLElement[] = [label, control]
  // The message container is always rendered, even when empty: it is the third
  // row of the field, and a grouped form reserves that row so an error cannot
  // reflow the rows below it.
  {
    // Help and error share ONE message row, so a field is always three rows
    // tall (label / control / message) whether or not it has anything to say.
    // That is what lets a grouped form align rows across columns.
    const message = h('div', { class: ${JSON.stringify(messageClass)} })
    // An error replaces the help text rather than stacking with it: one reason
    // per row keeps the reserved line one line tall, so nothing below moves.
    if (!error && (field.help || field.hints?.help)) {
      // The same sentence can arrive in both places (a generated spec carries
      // the help at the top level and under hints); show it once.
      const helpText = [...new Set([field.help, field.hints?.help].filter(Boolean))].join(' \\u2014 ')
      message.appendChild(h('div', { class: ${JSON.stringify(helpClass)}, id: \`\${id}-help\` }, helpText))
    }
    if (error) {
      message.appendChild(h('div', { class: ${JSON.stringify(errorClass)}, id: \`\${id}-error\`, role: 'alert' }, error))
    }
    parts.push(message)
  }
  // data-field is the stable hook a product uses to widen one control or point
  // layout CSS at it, without restyling the catalog classes.
  return h('div', { class: ${JSON.stringify(fieldClass)}, 'data-field': field.name }, ...parts)
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
    const max = v_max(field)
    for (const step of field.sanitize?.length ? field.sanitize : ['trim']) {
      // The recipe names the length as a token, slice(0, maxLength); it is
      // resolved here, not inside the step, so a null bound means no bound.
      value = applyStep(value, step, max)
    }
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
function applyStep(value: string, step: string, maxLength: number | null): string {
  const call = step.match(/^(\\w+)\\(([^)]*)\\)$/)
  if (call) {
    const args = call[2].split(',').map((a) => a.trim()).filter(Boolean)
    switch (call[1]) {
      case 'normalize': return value.normalize(args[0] ?? 'NFKC')
      case 'slice': {
        const start = Number(args[0] ?? 0)
        const rawEnd = args[1]
        const end = rawEnd === undefined
          ? undefined
          : rawEnd === 'maxLength'
            ? (maxLength ?? undefined)
            : Number(rawEnd)
        // An unbounded or unparseable bound must not truncate: String.slice
        // turns NaN into 0, which silently blanked every field whose catalog
        // type declares no maxLength.
        if (!Number.isFinite(start)) return value
        if (end !== undefined && !Number.isFinite(end)) return value
        return value.slice(start, end)
      }
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

  // Fields may declare a group (a section in the source schema). With no
  // groups this stays the single-column form it always was; with groups the
  // order they first appear in is the order the sections render.
  const grouped = visible.some((field) => field.group)
  if (!grouped) {
    for (const field of visible) {
      form.appendChild(renderField(field, values[field.name] ?? '', errors[field.name], busy, options.onChange))
    }
  } else {
    const order: string[] = []
    const sections = new Map<string, FieldSpec[]>()
    for (const field of visible) {
      const name = field.group ?? ''
      if (!sections.has(name)) {
        sections.set(name, [])
        order.push(name)
      }
      sections.get(name)!.push(field)
    }
    for (const name of order) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const section = h('section', {
        class: ${JSON.stringify(groupClass)},
        ...(slug ? { 'data-group': slug } : {}),
      })
      if (name) section.appendChild(h('h3', { class: ${JSON.stringify(titleClass)} }, name))
      for (const field of sections.get(name) ?? []) {
        section.appendChild(renderField(field, values[field.name] ?? '', errors[field.name], busy, options.onChange))
      }
      form.appendChild(section)
    }
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
  // A menu takes its items from the caller, not from a table: the catalog
  // entry describes the control, the application describes the menu.
  if (isMenuComponent(component)) {
    const module = renderMenuModule(component)
    return { module, fields: [], cssClasses: { ...(component.cssClasses ?? {}) } }
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