import { describe, it, expect } from 'vitest'
import { parseYaml } from './parse-yaml.js'
import {
  COMPONENT_FAMILIES,
  isDocumentPart,
  validateDocumentPart,
  assertValidDocumentPart,
  generateReportModule,
} from './catalog.js'
import type { CatalogComponent } from './types.js'

/** The shape from sure-document `docs/catalog.md §1`, verbatim in spirit. */
const REPORT_YAML = `
name: document-table
description: Repeating rows with a repeated header, kept together on a page.
tier: prototype
family: data
data:
  entity: invoices
  projection: [line_number, due_on, amount]
  shape: rows
print:
  keepTogether: true
  breakBefore: false
  repeatHeader: true
guards:
  - "totals.grand_total == sum(rows.amount)"
fixture:
  input: { rows: [{ line_number: 1, due_on: "2031-04-15", amount: 120.00 }] }
  expect: { html_contains: ["$120.00"], pages: 1 }
sure_ui: [table, form, buttons]
cssClasses:
  form: sure-table
  row: sure-table__row
  cell: sure-table__cell
`

function report(): CatalogComponent {
  return parseYaml(REPORT_YAML) as unknown as CatalogComponent
}

describe('catalog document-part extension: schema keys', () => {
  it('parses all five extension keys from a report yaml', () => {
    const c = report()
    expect(c.family).toBe('data')
    expect(c.data).toEqual({ entity: 'invoices', projection: ['line_number', 'due_on', 'amount'], shape: 'rows' })
    expect(c.print).toMatchObject({ keepTogether: true, breakBefore: false, repeatHeader: true })
    expect(c.guards).toEqual(['totals.grand_total == sum(rows.amount)'])
    expect(c.fixture?.expect).toMatchObject({ pages: 1 })
  })

  it('identifies a report as a document part and a plain yaml as not one', () => {
    expect(isDocumentPart(report())).toBe(true)
    expect(isDocumentPart({ name: 'form', sure_ui: ['form', 'buttons'] })).toBe(false)
  })

  it('exposes the closed family set', () => {
    expect([...COMPONENT_FAMILIES]).toEqual(['structure', 'data', 'figure'])
  })

  it('a valid report entry passes validation', () => {
    expect(validateDocumentPart(report())).toEqual([])
    expect(() => assertValidDocumentPart(report())).not.toThrow()
  })

  it('a plain form entry is untouched by document-part validation', () => {
    const form: CatalogComponent = { name: 'form', sure_ui: ['form', 'buttons'] }
    expect(validateDocumentPart(form)).toEqual([])
  })
})

describe('catalog document-part extension: guard validation', () => {
  it('fails loudly when a guard references a projection that does not exist', () => {
    const c = report()
    c.guards = ['totals.grand_total == sum(rows.not_a_column)']
    const issues = validateDocumentPart(c)
    expect(issues.map((i) => i.code)).toContain('UNKNOWN_PROJECTION')
    expect(issues[0]!.message).toContain('not_a_column')
    expect(issues[0]!.message).toContain('data.projection')
    expect(() => assertValidDocumentPart(c)).toThrow(/not_a_column/)
  })

  it('accepts a guard over a declared projection, and ignores computed totals and parameters', () => {
    const c = report()
    c.guards = [
      'totals.grand_total == sum(rows.amount)',
      'F:due_on != P:as_of',
    ]
    expect(validateDocumentPart(c)).toEqual([])
  })

  it('rejects a guard without any projection to check it against', () => {
    const c = report()
    c.data = { entity: 'invoices', shape: 'rows' }
    expect(validateDocumentPart(c).map((i) => i.code)).toContain('GUARD_WITHOUT_PROJECTION')
  })

  it('rejects an unknown family and an unknown data shape', () => {
    const c = report()
    c.family = 'report' as CatalogComponent['family']
    c.data!.shape = 'grid' as NonNullable<CatalogComponent['data']>['shape']
    const codes = validateDocumentPart(c).map((i) => i.code)
    expect(codes).toContain('BAD_FAMILY')
    expect(codes).toContain('BAD_SHAPE')
  })
})

describe('catalog document-part extension: report module', () => {
  it('emits a dependency-free module carrying the contract', () => {
    const src = generateReportModule(report())
    expect(src).toContain('export const CSS_CLASSES')
    expect(src).toContain('export const REPORT')
    expect(src).toContain('export const PROJECTION')
    expect(src).toContain('export const GUARDS')
    expect(src).toContain('export const STYLE_BLOCKS')
    expect(src).toContain('"line_number"')
    expect(src).toContain('totals.grand_total == sum(rows.amount)')
  })

  it('refuses to generate from an invalid entry', () => {
    const c = report()
    c.guards = ['sum(rows.ghost)']
    expect(() => generateReportModule(c)).toThrow(/ghost/)
  })

  it('refuses to generate for an entry with no document keys', () => {
    expect(() => generateReportModule({ name: 'form' })).toThrow(/not a document part/)
  })
})
