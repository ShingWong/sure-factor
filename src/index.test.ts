import { describe, it, expect } from 'vitest'
// Import straight from the barrel, exactly as a consumer does. A name that
// index.ts forgets to re-export fails here at collection time rather than
// silently shipping a README example that throws on import.
import {
  introspectSchema,
  matchColumnToType,
  matchColumnToTypeSync,
  loadAllTypesSync,
  generateForTier,
  generateStore,
  sanitize,
  sanitizeInput,
  sanitizeOutput,
  toYaml,
  toJson,
  fromJson,
  toMarkdown,
  toXml,
  fromXml,
  convert,
  formatCode,
  formatGeneratedOutput,
  formatGeneratedStoreOutput,
} from './index.js'
// Documented as a subpath import, not a root one.
import { introspectSchemaFromDdl, type ColumnInfo } from './introspect.js'

describe('public API surface (index barrel)', () => {
  it('re-exports the symbols the README imports from the root', () => {
    expect(typeof matchColumnToTypeSync).toBe('function')
    expect(typeof loadAllTypesSync).toBe('function')
    expect(typeof matchColumnToType).toBe('function')
  })

  it('re-exports the DDL-only introspector from the root barrel', () => {
    // Consumers must be able to introspect without a live connection.
    expect(typeof introspectSchemaFromDdl).toBe('function')
  })

  it('re-exports the documented generator and serializer API', () => {
    for (const fn of [
      introspectSchema,
      introspectSchemaFromDdl,
      generateForTier,
      generateStore,
      sanitize,
      sanitizeInput,
      sanitizeOutput,
      toYaml,
      toJson,
      fromJson,
      toMarkdown,
      toXml,
      fromXml,
      convert,
      formatCode,
      formatGeneratedOutput,
      formatGeneratedStoreOutput,
    ]) {
      expect(typeof fn).toBe('function')
    }
  })

  it('loadAllTypesSync returns the catalog', () => {
    const types = loadAllTypesSync()
    expect(Array.isArray(types)).toBe(true)
    expect(types.length).toBeGreaterThan(0)
    expect(types[0]).toHaveProperty('name')
  })

  it('matchColumnToTypeSync resolves a known column', () => {
    const emailCol: ColumnInfo = {
      columnName: 'email',
      dataType: 'varchar',
      isNullable: false,
      maxLength: null,
      defaultValue: null,
      isPrimaryKey: false,
      foreignKey: null,
    }
    const result = matchColumnToTypeSync(emailCol, loadAllTypesSync(), 'production')
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('email')
  })
})
