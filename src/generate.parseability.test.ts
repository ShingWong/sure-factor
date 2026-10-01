import { describe, it, expect } from 'vitest'
import { introspectSchemaFromDdl } from './introspect.js'
import { generateForTier, type GeneratedOutput } from './generate.js'

// A schema with the shapes that actually break generation: several tables,
// and columns whose names repeat across them. Every earlier test used either
// no columns or one column in one table, so none of these paths were reached.
const MULTI_TABLE_DDL = `
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
CREATE TABLE person_roles (
  role_name VARCHAR(100) NOT NULL,
  updated_at TIMESTAMPTZ
);
`

function generate(ddl: string, opts: Partial<Parameters<typeof generateForTier>[1]> = {}): GeneratedOutput {
  return generateForTier(introspectSchemaFromDdl(ddl), {
    tier: 'production',
    component: 'form',
    ...opts,
  })
}

/**
 * Compile a fragment that is meant to be an object body. Uses the real
 * TypeScript parser so the check matches what a consumer would hit.
 */
function parseObjectBody(source: string): { ok: true } | { ok: false; message: string } {
  // Wrap in a call expression so the fragment is evaluated as an object
  // literal, with stubs for the identifiers the generated code refers to.
  // The stubs matter: without them a fragment that parses but calls an
  // undefined `z` would be reported as a syntax failure, which is a different
  // bug. Only a real parse error should surface here.
  const wrapped = `
    const chain = { regex: () => chain, max: () => chain };
    const z = { string: () => chain };
    const sanitize = () => '';
    const input = {};
    return ({${source}});
  `
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(wrapped)
    fn()
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // A ReferenceError means the fragment evaluated far enough to call a
    // missing binding — the syntax was fine.
    if (e instanceof ReferenceError) return { ok: true }
    return { ok: false, message }
  }
}

describe('generateForTier: validation is parseable', () => {
  it('emits an object body that parses as JavaScript', () => {
    const { validation } = generate(MULTI_TABLE_DDL)
    const parsed = parseObjectBody(validation)
    expect(parsed.ok, `validation does not parse: ${!parsed.ok ? parsed.message : ''}\n---\n${validation}`).toBe(true)
  })

  it('emits an object body that parses when the schema has many columns', () => {
    const wide = Array.from({ length: 30 }, (_, i) => `col_${i} VARCHAR(50)`).join(', ')
    const { validation } = generate(`CREATE TABLE wide (${wide});`)
    const parsed = parseObjectBody(validation)
    expect(parsed.ok, `validation does not parse: ${!parsed.ok ? parsed.message : ''}`).toBe(true)
  })

  it('separates entries so object literals are well formed', () => {
    const { validation } = generate('CREATE TABLE t (email VARCHAR(255));')
    for (const line of validation.split('\n').filter(Boolean)) {
      expect(line.trimEnd().endsWith(',') || line.trimEnd() === validation.split('\n').filter(Boolean).at(-1)?.trimEnd(),
        `entry is not comma-terminated: ${line}`).toBe(true)
    }
  })

  it('emits no duplicate keys', () => {
    const { validation } = generate(MULTI_TABLE_DDL)
    const keys = validation
      .split('\n')
      .filter(Boolean)
      .map((l) => (l.trim().split(':')[0] ?? '').trim())
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes, `duplicate keys: ${[...new Set(dupes)].join(', ')}`).toEqual([])
  })

  it('qualifies colliding column names by table so no validator is lost', () => {
    const { validation } = generate(MULTI_TABLE_DDL)
    // `updated_at` exists in three tables; each occurrence must survive.
    const updatedAt = validation.split('\n').filter((l) => l.includes('updated_at'))
    expect(updatedAt.length, 'a validator was silently dropped for a repeated column name').toBeGreaterThanOrEqual(3)
  })

  it('keeps sanitization parseable too', () => {
    const { sanitization } = generate(MULTI_TABLE_DDL)
    const parsed = parseObjectBody(sanitization)
    expect(parsed.ok, `sanitization does not parse: ${!parsed.ok ? parsed.message : ''}`).toBe(true)
  })
})

describe('generateForTier: routes compile', () => {
  it('imports only what it uses', () => {
    const { routes } = generate('CREATE TABLE t (email VARCHAR(255));')
    const imported = [...routes.matchAll(/^import\s*\{([^}]+)\}/gm)].flatMap((m) =>
      (m[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    )
    for (const name of imported) {
      const body = routes.slice(routes.indexOf('\n', routes.indexOf('import')))
      const uses = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(body)
      expect(uses, `routes imports "${name}" but never uses it`).toBe(true)
    }
  })

  it('does not emit a router with zero routes while claiming validation', () => {
    const { routes } = generate(MULTI_TABLE_DDL)
    expect(routes).toMatch(/router\.(get|post|put|patch|delete)\(/)
  })

  it('references the validation it generates', () => {
    const { routes, validation } = generate(MULTI_TABLE_DDL)
    const firstKey = validation.split('\n').filter(Boolean)[0]?.trim().split(':')[0]?.trim()
    if (firstKey) expect(routes).toContain(firstKey)
  })
})

describe('generateForTier: template is well-formed', () => {
  it('never nests a double quote inside a double-quoted attribute', () => {
    const { template } = generate(MULTI_TABLE_DDL)
    for (const line of template.split('\n')) {
      for (const m of line.matchAll(/(\w+)="([^"]*)"/g)) {
        const attr = m[1] ?? ''
        const value = m[2] ?? ''
        // A value containing a bare " means the attribute terminated early.
        const rest = line.slice(m.index! + m[0].length)
        expect(value.includes('"'), `attribute ${attr} has unbalanced quotes: ${line.trim()}`).toBe(false)
        if (rest.startsWith('"')) expect(false, `attribute ${attr} closes early: ${line.trim()}`).toBe(true)
      }
    }
  })

  it('escapes i18n expressions so the attribute value survives', () => {
    const { template } = generate('CREATE TABLE t (email VARCHAR(255));')
    const line = template.split('\n').find((l) => l.includes('placeholder')) ?? ''
    const m = line.match(/placeholder="([^"]*)"/)
    expect(m, `placeholder attribute does not parse: ${line.trim()}`).not.toBeNull()
    expect(m![1]).toContain('i18n')
  })

  it('emits a self-closing input tag', () => {
    const { template } = generate(MULTI_TABLE_DDL)
    for (const line of template.split('\n')) {
      if (!/<input\b/.test(line)) continue
      expect(line.trimEnd().endsWith('/>'), `input tag not terminated: ${line.trim()}`).toBe(true)
    }
  })
})

describe('generateForTier: declared scripts exist in the catalog', () => {
  it('only returns scripts that resolve to a real asset', async () => {
    const { loadComponentScripts } = await import('./generate.js')
    const schema = introspectSchemaFromDdl('CREATE TABLE t (id SERIAL);')
    for (const component of ['form', 'data-table', 'crud-resource', 'session-list', 'search-filter']) {
      const scripts = loadComponentScripts(component)
      for (const s of scripts) {
        expect(s.exists, `component ${component} declares missing script ${s.name}`).toBe(true)
      }
    }
    expect(schema).toBeTruthy()
  })
})

describe('generateForTier: styles are real CSS', () => {
  it('emits declarations for the component css classes, not only a comment', () => {
    const { styles } = generate('CREATE TABLE t (email VARCHAR(255));')
    const nonComment = styles
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('/*') && !l.startsWith('*') && !l.endsWith('*/'))
    expect(nonComment.length, `styles is only a comment:\n${styles}`).toBeGreaterThan(0)
  })
})