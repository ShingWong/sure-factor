import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { generateClientComponent } from './generate-client.js'
import { introspectSchemaFromDdl } from './introspect.js'

/**
 * Phase D gate support: one client-render check per built-in catalog entry.
 * The assertion is deliberately structural — every entry must generate a
 * framework-free renderer whose class names come from its own YAML contract.
 * It does not claim that every component has a finished visual demo; that is
 * tracked separately in sure-store/components/COVERAGE.md.
 */
const DDL = `
  CREATE TABLE probe (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    items TEXT
  );
`

const catalogDir = new URL('../catalog/components/', import.meta.url)
const names = readdirSync(catalogDir)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => name.replace(/\.yaml$/, ''))
  .sort()

describe('catalog client render coverage', () => {
  it('discovers every built-in component exactly once', () => {
    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(names.length)
  })

  for (const name of names) {
    it(`${name} generates a dependency-free renderer`, () => {
      const out = generateClientComponent(introspectSchemaFromDdl(DDL), {
        tier: 'production',
        component: name,
        exportName: 'ProbeRenderer',
      })
      expect(out.module, `${name} emitted no renderer`).toMatch(/export function render(?:Form|Table|Menu)\(/)
      expect(out.module, `${name} pulled in a UI framework`).not.toMatch(/from ['"](?:react|vue|htmx|svelte|angular)/)
      expect(Object.keys(out.cssClasses).length, `${name} declared no cssClasses`).toBeGreaterThan(0)
      expect(out.module, `${name} lost its catalog traceability`).toContain(`catalog/${name}.yaml`)
    })
  }
})
