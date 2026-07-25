import { describe, it, expect } from 'vitest'
import type { CatalogType, CatalogComponent } from './types'
import type { ColumnInfo } from './introspect'

// Unit-test the type shapes and validation logic directly
describe('TypeScript type shapes', () => {
  it('CatalogType can be constructed', () => {
    const t: CatalogType = {
      name: 'test',
      match: { sql: "column_name LIKE '%test%'" },
      validation: { regex: '^\\d+$', maxLength: 10 },
      sanitize: { input: ['trim'], output: ['htmlEscape'] },
      hints: { en: { placeholder: 'test', help: 'A test', error: { format: 'Bad', required: 'Req' } } },
      tiers: { vibe: { validation: { regex: '^\\d+$', maxLength: null }, sanitize: ['trim'], hints: { en: { placeholder: 'test' } } } },
      security: { encrypt: false, notes: [] },
    }
    expect(t.name).toBe('test')
    expect(t.match!.sql).toContain('test')
  })

  it('CatalogType can have optional fields omitted', () => {
    const t: CatalogType = { name: 'minimal' }
    expect(t.name).toBe('minimal')
    expect(t.match).toBeUndefined()
    expect(t.validation).toBeUndefined()
    expect(t.security).toBeUndefined()
  })

  it('CatalogComponent can be constructed', () => {
    const c: CatalogComponent = {
      name: 'form',
      description: 'A form',
      tier: 'vibe',
      parameters: {
        fields: [{ name: 'email', type: 'email', required: true }],
        submitLabel: { en: 'Save', es: 'Guardar' },
        cancelLabel: { en: 'Cancel', es: 'Cancelar' },
      },
      behavior: {
        notificationModes: ['inline', 'toast'],
        audio: { errorBell: true, successChime: false },
        voiceHelp: false,
      },
      scripts: ['audio-feedback.js'],
      cssClasses: { form: 'form', field: 'field' },
    }
    expect(c.name).toBe('form')
    expect(c.parameters!.fields).toHaveLength(1)
    expect(c.parameters!.fields![0]!.name).toBe('email')
  })

  it('CatalogComponent can omit optional fields', () => {
    const c: CatalogComponent = { name: 'minimal' }
    expect(c.name).toBe('minimal')
    expect(c.parameters).toBeUndefined()
  })

  it('ColumnInfo shape is correct', () => {
    const col: ColumnInfo = {
      columnName: 'email',
      dataType: 'varchar',
      isNullable: false,
      maxLength: 255,
      defaultValue: null,
      isPrimaryKey: false,
      foreignKey: null,
    }
    expect(col.columnName).toBe('email')
    expect(col.maxLength).toBe(255)
    expect(col.foreignKey).toBeNull()
  })

  it('ColumnInfo can have foreign key', () => {
    const col: ColumnInfo = {
      columnName: 'user_id',
      dataType: 'integer',
      isNullable: true,
      maxLength: null,
      defaultValue: null,
      isPrimaryKey: false,
      foreignKey: { table: 'users', column: 'id' },
    }
    expect(col.foreignKey!.table).toBe('users')
    expect(col.foreignKey!.column).toBe('id')
  })
})