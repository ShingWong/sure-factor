import { describe, it, expect } from 'vitest'
import { generateForTier, loadComponentScripts } from './generate.js'
import type { SchemaInfo } from './introspect.js'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * The three Track-B (sure-mail) catalog entries — account-settings,
 * mail-search-filter, contact-form — load, generate and declare exactly what
 * their markup needs. The registry drift test guards the `sure_ui` lists
 * against sure-ui's COMPONENTS export; this guards the generator contract on
 * top of that: a template, composed styles, resolved scripts and the
 * notifications runtime (or an explicit null for pure-inline components).
 */
const schema: SchemaInfo = {
  tables: [{
    tableName: 'mail_account',
    schema: 'public',
    columns: [
      { columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null },
      { columnName: 'host', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null },
      { columnName: 'port', dataType: 'integer', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null },
    ],
  }],
}

const ENTRIES = ['account-settings', 'mail-search-filter', 'contact-form'] as const

/** A marker CSS class every theme's composed block for that family carries. */
const FAMILY_MARKER: Record<string, string> = {
  form: '.sure-form',
  buttons: '.btn-primary',
  search: '.sure-search',
}

describe('mail catalog entries: generated contract', () => {
  it('the catalog carries the three Track-B entries', () => {
    const files = readdirSync(new URL('../catalog/components/', import.meta.url))
      .filter((f: string) => f.endsWith('.yaml'))
      .map((f: string) => f.replace(/\.yaml$/, ''))
    for (const name of ENTRIES) expect(files, `missing catalog/${name}.yaml`).toContain(name)
  })

  for (const name of ENTRIES) {
    it(`${name} generates a template, styles and scripts`, () => {
      const out = generateForTier(schema, { tier: 'vibe', component: name })
      expect(out.template, `${name} has no form template`).toContain('<form')
      expect(out.template, `${name} submit is unstyled`).toContain('btn-primary')
      // styles are compose() output over the yaml's sure_ui blocks
      expect(out.styles).toMatch(/^\/\* Theme: \w[\w-]* — sure-ui compose \[/)
      expect(out.styles).toContain('@layer sure.tokens, sure.components, sure.mobile;')
      expect(out.styles).toContain(`for "${name}" */`)

      const blocks = readBlockList(name)
      expect(blocks.length, `${name} declares no sure_ui blocks`).toBeGreaterThan(0)
      expect(out.styles, `${name} header omits its sure_ui blocks`)
        .toContain(`sure-ui compose [${blocks.join(', ')}]`)
      for (const block of blocks) {
        const marker = FAMILY_MARKER[block]
        expect(marker, `no marker known for family ${block}`).toBeTruthy()
        expect(out.styles, `${name} styles omit the ${block} block`).toContain(marker!)
      }

      // every declared script resolves to a real catalog asset, and ships
      const inspected = loadComponentScripts(name)
      expect(inspected.every((s) => s.exists), `${name} declares a missing script`).toBe(true)
      expect(out.scripts).toEqual(inspected.map((s) => s.name))
    })
  }

  it('account-settings and contact-form ship the notifications runtime; mail-search-filter is pure inline', () => {
    // notificationModes: account-settings [inline, toast, statusBar],
    // contact-form [inline, toast] → runtime; mail-search-filter [inline]
    // renders in place → null (the runtime would be bytes nothing calls).
    expect(generateForTier(schema, { tier: 'vibe', component: 'account-settings' }).notifications).toBeTypeOf('string')
    expect(generateForTier(schema, { tier: 'vibe', component: 'contact-form' }).notifications).toBeTypeOf('string')
    expect(generateForTier(schema, { tier: 'vibe', component: 'mail-search-filter' }).notifications).toBeNull()
  })

  it('account-settings declares the form family its sure-form classes need', () => {
    // cssClasses maps every role to sure-form/sure-* + btn-* — the registry
    // test checks the mapping; this pins the intent for the M2 profile form.
    const yaml = readFileSync(new URL('../catalog/components/account-settings.yaml', import.meta.url), 'utf-8')
    expect(yaml).toMatch(/sure_ui:\n  - form\n  - buttons/)
    expect(yaml).toMatch(/submit: btn-primary/)
    expect(yaml).toMatch(/incomingHost|outgoingHost/)
  })
})

/** sure_ui block list straight from the yaml — the styles must compose them. */
function readBlockList(name: string): string[] {
  const text = readFileSync(new URL(`../catalog/components/${name}.yaml`, import.meta.url), 'utf-8')
  const m = /sure_ui:\n((?:  - [\w-]+\n)+)/.exec(text)
  return m ? [...m[1]!.matchAll(/  - ([\w-]+)/g)].map((x) => x[1]!) : []
}
