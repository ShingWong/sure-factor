/**
 * Executes the claims in `.opencode/skills/sure-factor/SKILL.md`.
 *
 * A skill is prose in a package, and prose rots silently: nothing fails when
 * `generateClientComponent` changes its options, when the catalog gains a
 * seventeenth type, or when a call the skill recommends starts throwing. An
 * agent then follows confident instructions into a runtime error and has no way
 * to tell the skill is stale.
 *
 * So every load-bearing claim is asserted here against the real library. If the
 * skill drifts, this fails.
 *
 *     npx vitest run src/skill.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  introspectSchemaFromDdl,
  loadAllTypesSync,
  matchColumnToTypeSync,
  generateClientComponent,
} from './index.js'

const skillPath = fileURLToPath(new URL('../.opencode/skills/sure-factor/SKILL.md', import.meta.url))
const skill = readFileSync(skillPath, 'utf8')

// The schema the skill's numbers were measured against, kept inline so this
// test does not depend on another repository being present.
//
// `introspectSchemaFromDdl` returns every table it is given, so the reduction
// the skill claims only shows up against a schema of realistic width. Two
// tables cut it to 40%, which is why the skill's own measurement used 25.
const DDL = `
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY,
  person_id UUID,
  subject VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL
);
CREATE TABLE IF NOT EXISTS persons (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL
);
${Array.from({ length: 20 }, (_, i) => `CREATE TABLE IF NOT EXISTS filler_${i} (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  updated_at TIMESTAMPTZ
);`).join('\n')}
`

describe('the skill file', () => {
  it('exists where the harness looks for it', () => {
    expect(existsSync(skillPath)).toBe(true)
  })

  it('has frontmatter with a name and a description', () => {
    // Only the description is resident in an agent's context, so it has to be
    // the thing that matches a request.
    const fm = /^---\n([\s\S]*?)\n---/.exec(skill)
    expect(fm, 'no YAML frontmatter').not.toBeNull()
    expect(fm![1]).toMatch(/^name:\s*\S+/m)
    expect(fm![1]).toMatch(/^description:\s*\S+/m)
  })

  it('describes when to use it in terms of the work, not the package', () => {
    const desc = /^description:\s*(.+)$/m.exec(skill)![1]!
    for (const cue of ['form', 'schema', 'match', 'column']) {
      expect(desc.toLowerCase(), `description omits "${cue}"`).toContain(cue)
    }
  })
})

describe('the skill recommends calls that exist', () => {
  it('every named export in the skill is really exported', () => {
    // Match the import lazily up to `} from` rather than with `[^}]+`: the
    // block's own comments contain braces (`-> { module, fields }`), which
    // truncated the match and made this test vacuous.
    const named = [...skill.matchAll(/import \{([\s\S]*?)\}\s*from "@shing\.wong\/sure-factor"/g)]
    expect(named, 'no import block found in the skill').not.toHaveLength(0)
    const symbols = named
      // Strip each line's trailing `//` explanation before splitting: a comment
      // can itself contain a comma, and splitting first would leave a fragment
      // glued to the next symbol.
      .flatMap((m) => m[1]!.split('\n').map((line) => line.replace(/\/\/.*$/, '')))
      .join('\n')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
    expect(symbols.length, `parsed ${symbols.length} symbols from the import block`).toBeGreaterThan(3)
    const api = mod as unknown as Record<string, unknown>
    for (const sym of symbols) {
      expect(typeof api[sym], `skill names a missing export: ${sym}`).toBe('function')
    }
  })

  it('the component names it recommends are real catalog templates', () => {
    const mentioned = [...skill.matchAll(/component: "([a-z-]+)"/g)].map((m) => m[1]!)
    expect(mentioned.length).toBeGreaterThan(0)
    for (const name of mentioned) {
      const file = fileURLToPath(new URL(`../catalog/components/${name}.yaml`, import.meta.url))
      expect(existsSync(file), `skill suggests component "${name}", which is not in the catalog`).toBe(true)
    }
  })
})

describe('the skill’s central claim: scope the DDL before introspecting', () => {
  it('the slice pattern in the skill matches the DDL the skill uses as its example', () => {
    expect(skill).toContain('CREATE TABLE IF NOT EXISTS tickets')
    // The pattern is a literal regex, so it has to match the fixture. An
    // earlier draft of the skill claimed `CREATE TABLE tickets` also worked,
    // which is true of the parser and false of the regex.
    const pattern = /CREATE TABLE IF NOT EXISTS tickets \([^;]*\);/i
    expect(pattern.test(DDL), 'the skill\'s slice pattern does not match the skill\'s own DDL').toBe(true)
  })

  it('still tells the reader to slice, rather than to introspect everything', () => {
    // The measurement below asserts a property of the *library*, so it keeps
    // passing whatever the skill says. This asserts the advice itself, which is
    // the half that actually rots: the numbers stay true while the
    // recommendation quietly stops being made.
    //
    // The two examples are labelled with a `//` comment inside the code fence,
    // so the fence containing "Don't" is the one to read.
    const fences = [...skill.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!)
    const discouraged = fences.find((f) => /\/\/\s*Don't/.test(f))
    const recommended = fences.find((f) => /\/\/\s*Do:/.test(f))
    expect(discouraged, 'no example labelled "Don\'t" in the skill').toBeTruthy()
    expect(recommended, 'no example labelled "Do:" in the skill').toBeTruthy()
    expect(discouraged).toMatch(/introspectSchemaFromDdl\(allDdl\)/)
    expect(recommended).toMatch(/introspectSchemaFromDdl\(ddl\)/)
  })

  it('slicing one table out of many is dramatically smaller', () => {
    const all = introspectSchemaFromDdl(DDL)
    const ddl = /CREATE TABLE IF NOT EXISTS tickets \([^;]*\);/i.exec(DDL)![0]
    const one = introspectSchemaFromDdl(ddl)

    expect(all.tables).toHaveLength(22)
    expect(one.tables).toHaveLength(1)
    expect(one.tables[0]!.tableName).toBe('tickets')

    const full = JSON.stringify(all).length
    const scoped = JSON.stringify(one).length
    // The skill claims 94%. Allow a wide margin so a schema change cannot make
    // this fail on rounding, but still catch the claim becoming false.
    expect(1 - scoped / full, `reduction is now ${(100 * (1 - scoped / full)).toFixed(0)}%, skill says 94%`)
      .toBeGreaterThan(0.8)
  })

  it('the scoped result is the same data, not a summary', () => {
    const ddl = /CREATE TABLE IF NOT EXISTS tickets \([^;]*\);/i.exec(DDL)![0]
    const scoped = introspectSchemaFromDdl(ddl).tables[0]!
    const full = introspectSchemaFromDdl(DDL).tables.find(t => t.tableName === 'tickets')!
    expect(scoped.columns).toEqual(full.columns)
  })

  it('there is still no filter parameter, so the skill is right to slice', () => {
    // If a `tables` option is ever added, the skill should say so rather than
    // send every reader down the slice path.
    expect(introspectSchemaFromDdl.length, 'introspectSchemaFromDdl gained a parameter; update the skill').toBe(1)
  })
})

describe('the skill’s guidance about matchColumnToType', () => {
  const types = loadAllTypesSync()

  it('a bare name works, as the skill says', () => {
    expect(matchColumnToTypeSync('email', types)!.type.name).toBe('email')
  })

  it('a name alone does not match a data_type-only rule', () => {
    // The skill tells a reader that null means "no type claims this". Verify a
    // column the catalog does not name really does come back null-or-text, so
    // the fallback the skill describes exists.
    const result = matchColumnToTypeSync('subject', types)
    expect(result?.type.name ?? 'text').toBe('text')
  })

  it('taking a column from the schema is the way to get its data type', () => {
    const schema = introspectSchemaFromDdl(DDL)
    const col = schema.tables.find(t => t.tableName === 'persons')!.columns.find(c => c.columnName === 'email')!
    expect(matchColumnToTypeSync(col, types)!.type.name).toBe('email')
  })

  it('a malformed column is refused with a message naming the fix', () => {
    // The skill tells a reader to take the column from the schema. If the error
    // stops saying so, the guidance has nothing to point at.
    expect(() => matchColumnToTypeSync(null as never, types)).toThrow(/ColumnInfo from the schema/)
  })
})

describe('the skill’s claims about the catalog', () => {
  it('one YAML type file is much smaller than dumping the catalog', () => {
    const dumped = JSON.stringify(loadAllTypesSync()).length
    const oneFile = readFileSync(fileURLToPath(new URL('../catalog/types/email.yaml', import.meta.url)), 'utf8').length
    expect(oneFile, `catalog/types/email.yaml is ${oneFile}B, dumped catalog is ${dumped}B`)
      .toBeLessThan(dumped / 3)
  })

  it('a catalog type file carries the sections the skill names', () => {
    const yaml = readFileSync(fileURLToPath(new URL('../catalog/types/email.yaml', import.meta.url)), 'utf8')
    for (const section of ['match:', 'validation:', 'sanitize:', 'hints:', 'tiers:']) {
      expect(yaml, `email.yaml has no ${section}`).toContain(section)
    }
  })

  it('the three tiers the skill names are the three the catalog has', () => {
    const tiers = Object.keys(loadAllTypesSync().find(t => t.name === 'email')!.tiers ?? {})
    expect(tiers.sort()).toEqual(['production', 'prototype', 'vibe'])
  })

  it('the skill\'s tier table holds for every type, not just the one it quotes', () => {
    // The table quotes `email`. If a future tier ever made `vibe` heavier than
    // `production` for some other type, the skill's "trade validation for less
    // code" claim would be false and the table would need rewriting.
    for (const type of loadAllTypesSync()) {
      const size = (tier: string) => JSON.stringify(type.tiers?.[tier as 'vibe'] ?? {}).length
      const [vibe, proto, prod] = [size('vibe'), size('prototype'), size('production')]
      expect(vibe, `${type.name}: vibe(${vibe}) > prototype(${proto})`).toBeLessThanOrEqual(proto)
      expect(proto, `${type.name}: prototype(${proto}) > production(${prod})`).toBeLessThanOrEqual(prod)
    }
  })
})

describe('the skill’s claim about generated module size', () => {
  const schema = introspectSchemaFromDdl(DDL)
  const gen = (s: typeof schema, component: 'form' | 'data-table' = 'form') =>
    generateClientComponent(s, { tier: 'production', component, exportName: 'X' })

  it('boilerplate dominates, so reading a big module to change one field is waste', () => {
    // Measured from a single table, which is what the skill's 16,856 refers to;
    // the wide fixture exists to test the introspection claim, not this one.
    const narrow = introspectSchemaFromDdl(/CREATE TABLE IF NOT EXISTS tickets \([^;]*\);/i.exec(DDL)![0])
    const wide = introspectSchemaFromDdl(DDL)
    const one = gen(narrow)
    const all = gen(wide)
    // Fixed cost, then what each extra field adds on top of it.
    const perField = (all.module.length - one.module.length) / (all.fields.length - one.fields.length)
    // The skill says ~16,856 chars fixed and ~700 per field. These are numbers
    // a reader budgets against, so assert them loosely enough to survive a
    // generator change but tightly enough to catch the claim going stale.
    expect(one.module.length, `smallest module is ${one.module.length} chars, skill says 16,856`)
      .toBeGreaterThan(10_000)
    expect(one.module.length, `smallest module is ${one.module.length} chars, skill says 16,856`)
      .toBeLessThan(25_000)
    expect(all.fields.length).toBeGreaterThan(one.fields.length)
    expect(perField, `marginal cost is ${perField.toFixed(0)} chars/field, skill says ~700`)
      .toBeGreaterThan(300)
    expect(perField).toBeLessThan(1500)
  })

  it('a data-table component renders a table, not a form', () => {
    const table = gen(schema, 'data-table')
    expect(table.module).toContain('export function renderTable(')
    expect(table.module).not.toContain('export function renderForm(')
  })

  it('the form component exports the functions the skill tells you to call', () => {
    const form = gen(schema)
    for (const fn of ['validateForm', 'sanitizeForm', 'renderForm', 'renderField']) {
      expect(form.module, `form module does not export ${fn}`).toContain(`export function ${fn}(`)
    }
  })

  it('the cssClasses the skill calls a contract really are one', () => {
    const { cssClasses } = gen(schema)
    expect(Object.values(cssClasses).length).toBeGreaterThan(0)
    for (const [key, value] of Object.entries(cssClasses)) {
      expect(typeof value, `cssClasses.${key} is not a class name`).toBe('string')
    }
  })
})

/** The module under test, for the export-existence assertion. */
const mod = await import('./index.js')
