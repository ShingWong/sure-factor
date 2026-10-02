import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { introspectSchemaFromDdl } from './introspect.js'
import { generateClientComponent } from './generate-client.js'
import { sanitize } from './sanitize.js'

const require = createRequire(import.meta.url)

// The console is a client-side SPA: it needs DOM-building code, not the
// Handlebars+htmx+express output the server target emits. These tests pin the
// client target to the same discipline as the server one — the module must
// parse, and the class names must come from the catalog rather than literals.

const DDL = `
CREATE TABLE persons (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE TABLE emails (
  email_id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ
);
`

/**
 * Type-check the emitted module with the real compiler. The output is
 * TypeScript (it declares the spec interfaces), so a `new Function` probe
 * would fail on the interfaces rather than on a real defect.
 */
function parsesAsModule(source: string): { ok: true } | { ok: false; message: string } {
  const file = new URL('./__generated_probe.ts', import.meta.url)
  try {
    writeFileSync(file, source)
    const spawnSync = require('node:child_process').spawnSync as typeof import('node:child_process').spawnSync
    const tsc = new URL('../node_modules/.bin/tsc', import.meta.url).pathname
    const res = spawnSync(tsc, [
      '--noEmit',
      '--skipLibCheck',
      '--target', 'es2022',
      '--module', 'esnext',
      '--lib', 'es2022,dom',
      '--strict',
      file.pathname,
    ], { encoding: 'utf-8' })
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
    if (res.status !== 0) return { ok: false, message: out.split('\n').slice(0, 6).join('\n') }
    return { ok: true }
  } finally {
    try {
      unlinkSync(file)
    } catch {
      /* best effort */
    }
  }
}

function gen(ddl = DDL, component = 'form') {
  return generateClientComponent(introspectSchemaFromDdl(ddl), {
    tier: 'production',
    component,
    exportName: 'TestForm',
  })
}

describe('generateClientComponent', () => {
  it('emits a module that parses as JavaScript', () => {
    const { module } = gen()
    const parsed = parsesAsModule(module)
    expect(parsed.ok, `module does not parse: ${!parsed.ok ? parsed.message : ''}`).toBe(true)
  })

  it('emits no framework import — it must run with no dependencies', () => {
    const { module } = gen()
    expect(module).not.toMatch(/^\s*import .*from ['"]react/m)
    expect(module).not.toMatch(/from ['"]htmx/)
  })

  it('takes its class names from the catalog cssClasses contract', () => {
    const { module, cssClasses } = gen('CREATE TABLE t (email VARCHAR(255));', 'form')
    expect(cssClasses.form).toBe('sure-form')
    expect(module).toContain('"sure-form"')
    expect(module).toContain('"sure-form__field"')
    expect(module).toContain('"sure-form__label"')
  })

  it('covers every class the console renders, with no unstyled leftovers', () => {
    const { cssClasses } = gen('CREATE TABLE t (email VARCHAR(255));', 'form')
    // These two were previously emitted by the console but declared nowhere in
    // the catalog, so no theme styled them.
    for (const key of ['form', 'field', 'label', 'input', 'help', 'error', 'title', 'actions']) {
      expect(cssClasses[key], `cssClasses.${key} is not declared in the catalog`).toBeTruthy()
    }
  })

  it('honours the data-table component contract too', () => {
    const { cssClasses } = gen('CREATE TABLE t (email VARCHAR(255));', 'data-table')
    expect(cssClasses.form).toBe('sure-table')
    expect(cssClasses.label).toBe('sure-table__header')
  })

  it('emits an element factory and a form renderer', () => {
    const { module } = gen()
    expect(module).toContain('export function h<')
    expect(module).toContain('export function renderField(')
    expect(module).toContain('export function renderForm(')
  })

  it('keeps the accessibility contract the React version had', () => {
    const { module } = gen()
    // These are what made the previous renderer usable with a screen reader.
    expect(module).toContain("'aria-invalid'")
    expect(module).toContain("'aria-describedby'")
    expect(module).toContain('role: \'alert\'')
    expect(module).toContain("'aria-hidden': 'true'")
    expect(module).toContain('novalidate: true')
  })

  it('qualifies colliding column names so no field is lost', () => {
    const { fields } = gen()
    const names = fields.map((f) => f.name)
    expect(new Set(names).size, 'duplicate field names').toBe(names.length)
    // updated_at exists in both tables; both must survive.
    expect(names.filter((n) => n.endsWith('updated_at')).length).toBeGreaterThanOrEqual(2)
  })

  it('carries validation and sanitisation from the catalog', () => {
    const { fields } = gen('CREATE TABLE t (email VARCHAR(255));')
    const email = fields.find((f) => f.source?.column === 'email')
    expect(email?.validation.maxLength).toBe(254)
    expect(email?.validation.regex).toBeTruthy()
    expect(email?.sanitize).toContain('lowercase')
  })

  it('keeps a slice(0, n) step whole', () => {
    const { fields } = gen('CREATE TABLE t (email VARCHAR(255));')
    const steps = fields.flatMap((f) => f.sanitize)
    expect(steps.some((s: string) => s.includes('slice(0, 254)')), `steps were split: ${JSON.stringify(steps)}`).toBe(true)
    expect(steps.some((s: string) => s === 'slice(0' || s === '254)')).toBe(false)
  })

  it('marks a primary key read-only', () => {
    const { fields } = gen('CREATE TABLE t (id UUID PRIMARY KEY, email VARCHAR(255));')
    expect(fields.find((f) => f.source?.column === 'id')?.readOnly).toBe(true)
  })

  it('embeds the field specs so a server can serialise them', () => {
    const { module, fields } = gen('CREATE TABLE t (email VARCHAR(255));')
    expect(module).toContain('export const GENERATED_FIELDS')
    // Extract by bracket-matching from the '=' that follows the type
    // annotation: `FieldSpec[]` contains a '[' of its own.
    const marker = 'GENERATED_FIELDS: FieldSpec[] ='
    const start = module.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const open = module.indexOf('[', start + marker.length)
    let depth = 0
    let end = open
    for (; end < module.length; end++) {
      const ch = module[end]
      if (ch === '[' || ch === '{') depth++
      else if (ch === ']' || ch === '}') {
        depth--
        if (depth === 0) {
          end++
          break
        }
      }
    }
    const parsed = JSON.parse(module.slice(open, end))
    expect(parsed.length).toBe(fields.length)
    expect(parsed[0]).toHaveProperty('validation')
    expect(parsed[0]).toHaveProperty('hints')
  })

  it('throws for an unknown component', () => {
    expect(() =>
      generateClientComponent(introspectSchemaFromDdl('CREATE TABLE t (id SERIAL);'), {
        tier: 'vibe',
        component: 'nope',
        exportName: 'X',
      }),
    ).toThrow()
  })
})
describe('generateClientComponent: table components', () => {
  it('emits a table renderer for data-table, not a form', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));', 'data-table')
    expect(module).toContain('export function renderTable(')
    expect(module).not.toContain('export function renderForm(')
    // Built through the element factory rather than an HTML string.
    expect(module).toContain("h('table'")
    expect(module).toContain("scope: 'col'")
    expect(module).toContain('"sure-table"')
    expect(module).toContain('"sure-table__header"')
    expect(module).toContain('"sure-table__cell"')
  })

  it('marks the selected row and exposes aria-selected', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));', 'data-table')
    expect(module).toContain("'aria-selected'")
    expect(module).toContain('is-selected')
  })

  it('renders an empty state rather than an empty table', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));', 'data-table')
    expect(module).toContain("role: 'status'")
    expect(module).toContain('Nothing here yet.')
  })

  it('emits table class names from the catalog, not form ones', () => {
    const { module, cssClasses } = gen('CREATE TABLE t (email VARCHAR(255));', 'data-table')
    expect(cssClasses.cell).toBe('sure-table__cell')
    expect(module).not.toContain('"sure-form__field"')
  })

  it('still emits the element factory so both modules share one approach', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));', 'data-table')
    expect(module).toContain('export function h<')
  })
})

describe('generateClientComponent: table cells accept nodes', () => {
  it('appends a Node cell instead of stringifying it', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));', 'data-table')
    expect(module).toContain('function appendCell(')
    expect(module).not.toContain('cellText(')
    // A Node-valued cell must be appended, not coerced to a string.
    expect(module).toContain("'nodeType' in")
  })

  it('still renders a dash for empty values', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));', 'data-table')
    expect(module).toContain('emptyText')
  })
})

describe('generateClientComponent: form validation lives in the component', () => {
  it('exports validateForm and sanitizeForm', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    expect(module).toContain('export function validateForm(')
    expect(module).toContain('export function sanitizeForm(')
  })

  it('validates before submitting, and not after', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    const submit = module.slice(module.indexOf('onsubmit:'))
    expect(submit).toContain('validateForm(spec, values)')
    // The success path must run validation first. (`onSubmit` also appears
    // earlier, in the `validate: false` escape hatch, so compare against the
    // success branch specifically.)
    const success = submit.slice(submit.indexOf('const found = validateForm'))
    expect(success).toContain('Object.keys(found).length === 0')
    expect(success.indexOf('validateForm')).toBeLessThan(success.indexOf('options.onSubmit'))
  })

  it('offers an escape hatch for draft saves', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    expect(module).toContain('options.validate === false')
    expect(module).toContain('onInvalid?: (errors: Record<string, string>) => void')
  })

  it('carries the catalog error messages into the component', () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    expect(module).toContain('field.hints?.error?.required')
    expect(module).toContain('field.hints?.error?.format')
    expect(module).toContain('must be valid JSON')
  })
})

/**
 * The generated `sanitizeForm` is the one piece of this output a consumer runs
 * on every keystroke, and a test that only reads its source cannot tell whether
 * it does anything. Earlier it trimmed and stopped — every catalog sanitisation
 * step was silently dropped, so `stripControl` let control characters through an
 * email field. These tests compile the emitted module and call the real
 * function.
 */
describe('generateClientComponent: the emitted sanitiser actually sanitises', () => {
  /** Compile the emitted module with tsc, then evaluate the JavaScript. */
  async function load(module: string): Promise<{ sanitizeForm: (s: unknown, v: unknown) => Record<string, string> }> {
    const dir = mkdtempSync(joinPath(tmpdir(), 'sure-factor-gen-'))
    const src = joinPath(dir, 'mod.ts')
    try {
      writeFileSync(src, module)
      const spawnSync = require('node:child_process').spawnSync as typeof import('node:child_process').spawnSync
      const tsc = new URL('../node_modules/.bin/tsc', import.meta.url).pathname
      const res = spawnSync(tsc, [
        '--outDir', dir,
        '--skipLibCheck',
        '--target', 'es2022',
        '--module', 'esnext',
        '--lib', 'es2022,dom',
        '--strict',
        src,
      ], { encoding: 'utf-8' })
      const log = `${res.stdout ?? ''}${res.stderr ?? ''}`
      if (res.status !== 0) {
        throw new Error(`tsc rejected the emitted module:\n${log.split('\n').slice(0, 6).join('\n')}`)
      }
      // tsc emits mod.js for an ESM target; rename so Node loads it as a module.
      const compiled = joinPath(dir, 'mod.mjs')
      writeFileSync(compiled, readFileSync(joinPath(dir, 'mod.js'), 'utf8'))
      return (await import(pathToFileURL(compiled).href)) as never
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const spec = (field: Record<string, unknown>) => ({
    id: 't', title: 'T', fields: [{ name: 'f', label: 'F', help: '', required: false, control: 'text', type: 'text', validation: {}, hints: {}, sanitize: ['trim'], source: null, ...field }],
  })

  it('applies the catalog steps it is given', async () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    const { sanitizeForm } = await load(module)
    // email's catalog recipe: trim, lowercase, normalize: NFKC, stripControl, slice.
    // A NUL and a BEL: the sort of characters stripControl exists to remove.
    const out = sanitizeForm(spec({ sanitize: ['trim', 'lowercase', 'stripControl'] }), { f: '  ADA\u0000\u0007@Example.COM  ' })
    expect(out.f).toBe('ada@example.com')
  })

  it('runs a parameterised step, which the catalog writes as a mapping', async () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    const { sanitizeForm } = await load(module)
    const out = sanitizeForm(spec({ sanitize: ['trim', 'normalize(NFKC)'] }), { f: '  ＡＤＡ  ' })
    expect(out.f).toBe('ADA')
  })

  it('ignores a step it does not know rather than blanking the value', async () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    const { sanitizeForm } = await load(module)
    const out = sanitizeForm(spec({ sanitize: ['trim', 'someFutureStep'] }), { f: '  keep me  ' })
    expect(out.f).toBe('keep me')
  })

  it('trims a field whose spec declares no steps', async () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    const { sanitizeForm } = await load(module)
    expect(sanitizeForm(spec({ sanitize: [] }), { f: '  x  ' }).f).toBe('x')
  })

  it('caps at maxLength, but not for a textarea', async () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    const { sanitizeForm } = await load(module)
    const field = { sanitize: ['trim'], validation: { maxLength: 3 } }
    expect(sanitizeForm(spec(field), { f: 'abcdef' }).f).toBe('abc')
    expect(sanitizeForm(spec({ ...field, control: 'textarea' }), { f: 'abcdef' }).f).toBe('abcdef')
  })

  it('leaves a hidden field alone', async () => {
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    const { sanitizeForm } = await load(module)
    const out = sanitizeForm(spec({ control: 'hidden', sanitize: ['trim', 'lowercase'] }), { f: '  ID  ' })
    expect(out.f).toBe('  ID  ')
  })

  it('agrees with sure-factor\'s own sanitize() on the same steps', async () => {
    // The generated copy is duplicated to keep the module dependency-free, so
    // it can drift. Compare the two on every step the catalog actually uses.
    const { module } = gen('CREATE TABLE t (email VARCHAR(255));')
    const { sanitizeForm } = await load(module)
    const steps = [
      'trim', 'lowercase', 'uppercase', 'collapseWhitespace', 'stripNonDigits',
      'stripControl', 'stripDirectionOverrides', 'stripZeroWidth', 'htmlEscape',
      'normalize(NFKC)', 'slice(0, 5)',
    ]
    const samples = ['  Ada Lovelace  ', '\uFF21\uFF24\uFF21', 'a\u0007bc', '(555) 123-4567', '<b>hi</b>']
    for (const sample of samples) {
      const mine = sanitizeForm(spec({ sanitize: steps }), { f: sample }).f
      const theirs = sanitize(sample, steps)
      expect(mine, `${JSON.stringify(sample)} via ${steps.join(',')}`).toBe(theirs)
    }
  })
})
