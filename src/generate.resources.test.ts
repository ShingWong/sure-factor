import { describe, it, expect } from 'vitest'
import { introspectSchemaFromDdl } from './introspect.js'
import type { CatalogComponent } from './types.js'
import { generateForTier } from './generate.js'

/**
 * The server target generates ONE resource per call. These tests pin the three
 * structural gaps: a multi-table schema must not be flattened into one form,
 * `data-table` must emit a real table, and a document part must not be wrapped
 * in a form or given a submit button. Entities and domains are fictional.
 */
const DDL = `
  CREATE TABLE invoices (
    id UUID PRIMARY KEY,
    recipient_email VARCHAR(255) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    issued_on DATE
  );
  CREATE TABLE suppliers (
    id UUID PRIMARY KEY,
    contact_email VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL
  );
`
const schema = introspectSchemaFromDdl(DDL)

describe('generateForTier: one resource per call', () => {
  it('scopes template, routes and validation to tableName', () => {
    const out = generateForTier(schema, {
      tier: 'production', component: 'form', tableName: 'suppliers',
    })

    expect(out.template).toContain('name="contact_email"')
    expect(out.template).toContain('name="display_name"')
    expect(out.template).not.toContain('name="recipient_email"')
    expect(out.template).not.toContain('name="amount"')

    expect(out.routes).toContain("router.get('/suppliers'")
    expect(out.routes).not.toContain("router.get('/invoices'")
    expect(out.i18n['types.email.label']).toBeDefined()

    const validationKeys = out.validation.split('\n').filter(Boolean).map(l => l.trim().split(':')[0])
    expect(validationKeys).toContain('"contact_email"')
    expect(validationKeys.some(k => k?.includes('recipient_email'))).toBe(false)
  })

  it('defaults to the first table when no option is given', () => {
    const out = generateForTier(schema, { tier: 'prototype', component: 'form' })
    expect(out.template).toContain('name="recipient_email"')
    expect(out.template).not.toContain('name="contact_email"')
    expect(out.routes).toContain("router.get('/invoices'")
  })

  it('accepts resource as an alias and rejects unknown or conflicting selections', () => {
    const aliased = generateForTier(schema, {
      tier: 'prototype', component: 'form', resource: 'suppliers',
    })
    expect(aliased.template).toContain('name="contact_email"')

    expect(() => generateForTier(schema, {
      tier: 'prototype', component: 'form', tableName: 'ghost_entities',
    })).toThrow(/not found in schema/)

    expect(() => generateForTier(schema, {
      tier: 'prototype', component: 'form', tableName: 'invoices', resource: 'suppliers',
    })).toThrow(/Conflicting resource selection/)
  })
})

describe('generateForTier: data-table emits a table, not a form', () => {
  it('renders thead, tbody and bound cells with sure-ui table classes', () => {
    const out = generateForTier(schema, {
      tier: 'prototype', component: 'data-table', tableName: 'invoices',
    })
    const { template } = out

    expect(template).toContain('<table class="sure-table"')
    expect(template).toContain('data-resource="invoices"')
    expect(template).toContain('<thead>')
    expect(template).toContain('<tbody>')
    expect(template).toContain('<th class="sure-table__header" scope="col">')
    expect(template).toContain('<tr class="sure-table__row">')
    expect(template).toContain('<td class="sure-table__cell">{{this.recipient_email}}</td>')
    expect(template).toContain('<td class="sure-table__cell">{{this.amount}}</td>')
    expect(template).toContain('{{#each rows}}')
    expect(template).not.toContain('name="recipient_email"')
    expect(template).not.toContain('<form')
    expect(template).not.toContain('<input')
    expect(template).not.toContain('btn-primary')
  })

  it('keeps the form component structurally different', () => {
    const form = generateForTier(schema, {
      tier: 'prototype', component: 'form', tableName: 'invoices',
    })
    expect(form.template).toContain('<form class="sure-form"')
    expect(form.template).toContain('hx-post="/{{resource}}"')
    expect(form.template).toContain('<input')
    expect(form.template).toContain('btn-primary')
    expect(form.template).not.toContain('<table')
  })
})

/** A report entry in the shape sure-store publishes in components/*.yaml. It
 *  still declares form/buttons in sure_ui (the registry coverage guards), but
 *  its markup must not use them. */
const report: CatalogComponent = {
  name: 'document-invoice-summary',
  family: 'data',
  data: { entity: 'invoices', projection: ['amount', 'issued_on'], shape: 'rows' },
  print: { keepTogether: true, breakBefore: false, repeatHeader: true },
  guards: ['totals.grand_total == sum(rows.amount)'],
  fixture: { input: { synthetic: true }, expect: { guards_pass: true } },
  sure_ui: ['table', 'document', 'figure', 'form', 'buttons'],
  cssClasses: {
    form: 'sure-form', // declared for class coverage, not rendered
    table: 'sure-table',
    row: 'sure-table__row',
    cell: 'sure-table__cell',
    header: 'sure-table__header',
    print: 'sure-table--print',
  },
}

describe('generateForTier: document parts are emitted directly', () => {
  it('emits the declared projection with document blocks and no form or submit', () => {
    const out = generateForTier(schema, {
      tier: 'prototype', component: report.name, componentDefinition: report, tableName: 'invoices',
    })
    const { template } = out

    expect(template).toContain('class="sure-document sure-document__section"')
    expect(template).toContain('data-document-part="document-invoice-summary"')
    expect(template).toContain('data-family="data"')
    expect(template).toContain('data-shape="rows"')
    expect(template).toContain('data-projection="amount issued_on"')
    expect(template).toContain('<table class="sure-table sure-table--print"')
    expect(template).toContain('<th class="sure-table__header" scope="col">Amount</th>')
    expect(template).toContain('<td class="sure-table__cell">{{this.amount}}</td>')
    expect(template).toContain('<td class="sure-table__cell">{{this.issued_on}}</td>')
    expect(template).toContain('{{#each rows}}')

    expect(template).not.toContain('<form')
    expect(template).not.toContain('btn-primary')
    expect(template).not.toContain('sure-form')
    expect(template).not.toContain('<input')

    // The declared sure-ui blocks are still composed into the stylesheet.
    expect(out.styles).toContain('.sure-document')
    expect(out.styles).toContain('.sure-figure')
    expect(out.styles).toContain('.sure-table')
  })

  it('emits figure markup for a figure-family part', () => {
    const graphic: CatalogComponent = {
      ...report,
      name: 'document-graphic',
      family: 'figure',
      data: { entity: 'graphics', projection: ['alt'], shape: 'none' },
      guards: ['ifpresent(record.alt, true)'],
      sure_ui: ['document', 'figure', 'form', 'buttons'],
      cssClasses: {
        form: 'sure-form',
        graphic: 'sure-document__graphic',
        plot: 'sure-figure__plot',
      },
    }
    const { template } = generateForTier(schema, {
      tier: 'prototype', component: graphic.name, componentDefinition: graphic, tableName: 'invoices',
    })
    expect(template).toContain('<figure class="sure-figure">')
    expect(template).toContain('class="sure-document__graphic"')
    expect(template).toContain('class="sure-figure__plot"')
    expect(template).not.toContain('<form')
    expect(template).not.toContain('btn-primary')
  })

  it('still fails loudly for an invalid document part', () => {
    const invalid: CatalogComponent = {
      ...report,
      guards: ['totals.grand_total == sum(rows.unknown_field)'],
    }
    expect(() => generateForTier(schema, {
      tier: 'prototype', component: invalid.name, componentDefinition: invalid, tableName: 'invoices',
    })).toThrow(/Invalid document part/)
  })
})
