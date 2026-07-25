import { describe, it, expect } from 'vitest'
import { introspectSchemaFromDdl } from './introspect'
import { loadAllTypesSync, matchColumnToTypeSync } from './match'
import { generateForTier } from './generate'
import { generateStore } from './generate-store'

describe('full pipeline: introspect → match → generate', () => {
  const ddl = `
    CREATE TABLE patients (
      id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      full_name VARCHAR(100) NOT NULL,
      diagnosis VARCHAR(8),
      zip VARCHAR(5),
      phone VARCHAR(20),
      is_active BOOLEAN NOT NULL DEFAULT true,
      date_of_birth DATE,
      metadata JSONB,
      notes TEXT
    );
  `

  const allTypes = loadAllTypesSync()

  it('introspect parses the DDL', () => {
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables).toHaveLength(1)
    expect(schema.tables[0]!.tableName).toBe('patients')
    expect(schema.tables[0]!.columns).toHaveLength(10)
  })

  it('match identifies email column', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const emailCol = schema.tables[0]!.columns.find(c => c.columnName === 'email')!
    const result = matchColumnToTypeSync(emailCol, allTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('email')
    expect(result!.confidence).toBeGreaterThan(0)
  })

  it('match identifies name columns', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const nameCol = schema.tables[0]!.columns.find(c => c.columnName === 'full_name')!
    const result = matchColumnToTypeSync(nameCol, allTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('full-name')
  })

  it('match identifies diagnosis as icd10', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const dxCol = schema.tables[0]!.columns.find(c => c.columnName === 'diagnosis')!
    const result = matchColumnToTypeSync(dxCol, allTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('icd10')
  })

  it('match identifies zip column', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const zipCol = schema.tables[0]!.columns.find(c => c.columnName === 'zip')!
    const result = matchColumnToTypeSync(zipCol, allTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('zip5')
  })

  it('match identifies phone column', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const phoneCol = schema.tables[0]!.columns.find(c => c.columnName === 'phone')!
    const result = matchColumnToTypeSync(phoneCol, allTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('us-phone')
  })

  it('match falls back to text for unknown columns', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const notesCol = schema.tables[0]!.columns.find(c => c.columnName === 'notes')!
    const result = matchColumnToTypeSync(notesCol, allTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('text')
  })

  it('generateForTier produces vibe-tier output', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(result.routes).toContain('patients')
    expect(result.template).toContain('<form')
    expect(result.validation).toBeTruthy()
    expect(result.scripts).toBeInstanceOf(Array)
    expect(result.styles).toContain('nord')
  })

  it('generateForTier produces production-tier output with all features', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const result = generateForTier(schema, { tier: 'production', component: 'form-modal' })
    expect(result.routes).toContain('patients')
    expect(result.template).toContain('<form')
    expect(result.styles).toContain('nord')
    expect(Object.keys(result.i18n).length).toBeGreaterThan(0)
  })

  it('generateForTier throws for unknown component', () => {
    const schema = introspectSchemaFromDdl(ddl)
    expect(() => generateForTier(schema, { tier: 'vibe', component: 'nonexistent' })).toThrow()
  })

  it('generateStore produces interface matching introspected columns', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const table = schema.tables[0]!
    const result = generateStore({
      tableName: table.tableName,
      columns: table.columns,
      tier: 'production',
    })
    expect(result.interfaceCode).toContain('export interface Patients')
    expect(result.interfaceCode).toContain('email: string')
    expect(result.interfaceCode).toContain('full_name: string')
    expect(result.interfaceCode).toContain('is_active: boolean')
    expect(result.fullCode).toContain('createEntityStore')
    expect(result.fullCode).toContain("fetch('/api/patients'")
  })

  it('coherence: matched types appear in generated i18n keys', () => {
    const schema = introspectSchemaFromDdl(ddl)
    const result = generateForTier(schema, { tier: 'production', component: 'form', locale: 'en' })
    const i18nKeys = Object.keys(result.i18n)
    expect(i18nKeys.some(k => k.startsWith('types.email'))).toBe(true)
    expect(i18nKeys.some(k => k.startsWith('types.full-name'))).toBe(true)
  })

  it('full pipeline: all modules work together without errors', () => {
    const schema = introspectSchemaFromDdl(ddl)

    for (const tier of ['vibe', 'prototype', 'production'] as const) {
      const genResult = generateForTier(schema, { tier, component: 'form' })
      expect(genResult.routes).toBeTruthy()
      expect(genResult.template).toBeTruthy()

      const table = schema.tables[0]!
      const storeResult = generateStore({
        tableName: table.tableName,
        columns: table.columns,
        tier,
      })
      expect(storeResult.interfaceCode).toBeTruthy()
      expect(storeResult.storeCode).toBeTruthy()
      expect(storeResult.apiCode).toBeTruthy()
    }
  })
})

describe('full pipeline: multi-table schema', () => {
  const multiDdl = `
    CREATE TABLE patients (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(100) NOT NULL
    );
    CREATE TABLE claims (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER REFERENCES patients(id),
      diagnosis VARCHAR(8),
      amount NUMERIC(10,2),
      status VARCHAR(20)
    );
  `

  it('introspect parses multiple tables', () => {
    const schema = introspectSchemaFromDdl(multiDdl)
    expect(schema.tables).toHaveLength(2)
    expect(schema.tables[0]!.tableName).toBe('patients')
    expect(schema.tables[1]!.tableName).toBe('claims')
  })

  it('generateForTier uses the first table', () => {
    const schema = introspectSchemaFromDdl(multiDdl)
    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(result.routes).toContain('patients')
  })

  it('generateStore generates per-table stores', () => {
    const schema = introspectSchemaFromDdl(multiDdl)
    for (const table of schema.tables) {
      const store = generateStore({
        tableName: table.tableName,
        columns: table.columns,
        tier: 'production',
      })
      expect(store.interfaceCode).toContain(`export interface ${table.tableName.charAt(0).toUpperCase() + table.tableName.slice(1)}`)
      expect(store.storeCode).toContain('createEntityStore')
    }
  })
})
