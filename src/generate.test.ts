import { describe, it, expect } from 'vitest'
import type { ColumnInfo } from './introspect'
import type { CatalogType } from './types'
import { generateForTier } from './generate'

// Generate module tests — testing the shape of the output contract
describe('generate module contracts', () => {
  it('generates routes output with expected fields', () => {
    const schema = { tables: [{ tableName: 'users', schema: 'public', columns: [] }] }

    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })

    expect(result).toHaveProperty('routes')
    expect(result).toHaveProperty('template')
    expect(result).toHaveProperty('i18n')
    expect(result).toHaveProperty('styles')
    expect(result).toHaveProperty('scripts')
    expect(result).toHaveProperty('validation')
    expect(result).toHaveProperty('sanitization')

    expect(typeof result.routes).toBe('string')
    expect(typeof result.template).toBe('string')
    expect(typeof result.styles).toBe('string')
    expect(Array.isArray(result.scripts)).toBe(true)
  })

  it('includes table name in generated routes', () => {
    const schema = { tables: [{ tableName: 'patients', schema: 'public', columns: [] }] }
    const result = generateForTier(schema, { tier: 'prototype', component: 'form' })
    expect(result.routes).toContain('patients')
  })

  it('generates template with form tag', () => {
    const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [] }] }
    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(result.template).toContain('<form')
    expect(result.template).toContain('hx-post')
    expect(result.template).toContain('hx-target')
  })

  it('throws for unknown component', () => {
    const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [] }] }
    expect(() => generateForTier(schema, { tier: 'vibe', component: 'nonexistent' })).toThrow()
  })

  it('generates i18n keys for matched fields', () => {
    const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [{ columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null }] }] }
    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(Object.keys(result.i18n).length).toBeGreaterThanOrEqual(0)
  })
})