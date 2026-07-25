import { describe, it, expect } from 'vitest'
import { generateStore } from './generate-store'
import type { ColumnInfo } from './introspect'

describe('generateStore', () => {
  const patientColumns: ColumnInfo[] = [
    { columnName: 'id', dataType: 'uuid', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: true, foreignKey: null },
    { columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null },
    { columnName: 'full_name', dataType: 'varchar', isNullable: false, maxLength: 100, defaultValue: null, isPrimaryKey: false, foreignKey: null },
    { columnName: 'diagnosis', dataType: 'varchar', isNullable: true, maxLength: 8, defaultValue: null, isPrimaryKey: false, foreignKey: null },
    { columnName: 'date_of_birth', dataType: 'date', isNullable: true, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null },
    { columnName: 'is_active', dataType: 'boolean', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null },
  ]

  it('generates entity interface with correct name', () => {
    const result = generateStore({
      tableName: 'patients',
      columns: patientColumns,
      tier: 'prototype',
    })
    expect(result.interfaceCode).toContain('export interface Patients')
    expect(result.interfaceCode).toContain('id: string')
    expect(result.interfaceCode).toContain('email: string')
    expect(result.interfaceCode).toContain('full_name: string')
    expect(result.interfaceCode).toContain('diagnosis?: string | null')
    expect(result.interfaceCode).toContain('date_of_birth?: string | null')
    expect(result.interfaceCode).toContain('is_active: boolean')
  })

  it('generates api adapter with correct path', () => {
    const result = generateStore({
      tableName: 'claims',
      columns: patientColumns,
      tier: 'vibe',
      apiPath: '/api/v2/claims',
    })
    expect(result.apiCode).toContain("fetch('/api/v2/claims')")
    expect(result.apiCode).toContain("fetch(`/api/v2/claims/${id}`)")
    expect(result.apiCode).toContain("method: 'POST'")
    expect(result.apiCode).toContain("method: 'PUT'")
    expect(result.apiCode).toContain("method: 'DELETE'")
  })

  it('generates store with client-first sync for vibe tier', () => {
    const result = generateStore({
      tableName: 'items',
      columns: patientColumns,
      tier: 'vibe',
    })
    expect(result.storeCode).toContain("sync: 'client-first'")
    expect(result.storeCode).not.toContain('versioning: true')
    expect(result.storeCode).toContain('createEntityStore')
  })

  it('generates store with server-first sync and versioning for production tier', () => {
    const result = generateStore({
      tableName: 'patients',
      columns: patientColumns,
      tier: 'production',
    })
    expect(result.storeCode).toContain("sync: 'server-first'")
    expect(result.storeCode).toContain('versioning: true')
  })

  it('generates onMutate for prototype and production tiers', () => {
    const vibe = generateStore({ tableName: 't', columns: patientColumns, tier: 'vibe' })
    expect(vibe.storeCode).not.toContain('onMutate')

    const proto = generateStore({ tableName: 't', columns: patientColumns, tier: 'prototype' })
    expect(proto.storeCode).toContain('onMutate')

    const prod = generateStore({ tableName: 't', columns: patientColumns, tier: 'production' })
    expect(prod.storeCode).toContain('onMutate')
  })

  it('fullCode combines interface, api, and store', () => {
    const result = generateStore({
      tableName: 'patients',
      columns: patientColumns,
      tier: 'prototype',
    })
    expect(result.fullCode).toContain("import { createEntityStore } from 'sure-state'")
    expect(result.fullCode).toContain('export interface Patients')
    expect(result.fullCode).toContain('const patientsApi')
    expect(result.fullCode).toContain('export const patientsStore = createEntityStore<Patients>')
  })

  it('handles single-word table names', () => {
    const cols: ColumnInfo[] = [
      { columnName: 'id', dataType: 'uuid', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: true, foreignKey: null },
      { columnName: 'name', dataType: 'varchar', isNullable: false, maxLength: 100, defaultValue: null, isPrimaryKey: false, foreignKey: null },
    ]
    const result = generateStore({ tableName: 'user', columns: cols, tier: 'vibe' })
    expect(result.interfaceCode).toContain('export interface User')
    expect(result.storeCode).toContain('export const userStore')
  })

  it('handles multi-word table names with underscores', () => {
    const cols: ColumnInfo[] = [
      { columnName: 'id', dataType: 'uuid', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: true, foreignKey: null },
    ]
    const result = generateStore({ tableName: 'insurance_claims', columns: cols, tier: 'vibe' })
    expect(result.interfaceCode).toContain('export interface InsuranceClaims')
    expect(result.storeCode).toContain('export const insuranceClaimsStore')
  })

  it('maps SQL types to TypeScript types correctly', () => {
    const allTypes: ColumnInfo[] = [
      { columnName: 'id', dataType: 'uuid', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: true, foreignKey: null },
      { columnName: 'count', dataType: 'integer', isNullable: true, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null },
      { columnName: 'amount', dataType: 'bigint', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null },
      { columnName: 'metadata', dataType: 'jsonb', isNullable: true, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null },
      { columnName: 'notes', dataType: 'text', isNullable: true, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null },
    ]
    const result = generateStore({ tableName: 'test', columns: allTypes, tier: 'vibe' })
    expect(result.interfaceCode).toContain('count?: number | null')
    expect(result.interfaceCode).toContain('amount: number')
    expect(result.interfaceCode).toContain('metadata?: Record<string, unknown> | null')
    expect(result.interfaceCode).toContain('notes?: string | null')
  })

  it('skips id column in interface property generation', () => {
    const cols: ColumnInfo[] = [
      { columnName: 'id', dataType: 'uuid', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: true, foreignKey: null },
    ]
    const result = generateStore({ tableName: 'test', columns: cols, tier: 'vibe' })
    const idCount = (result.interfaceCode.match(/\bid\b/g) || []).length
    expect(idCount).toBe(1)
  })
})
