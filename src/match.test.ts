import { describe, it, expect } from 'vitest'
import type { ColumnInfo } from './introspect'
import type { CatalogType } from './types'
import { matchColumnToTypeSync } from './match'

const mockTypes: CatalogType[] = [
  {
    name: 'email',
    match: { sql: "column_name LIKE '%email%' OR column_name LIKE '%mail%'" },
    validation: { regex: '^[^@]+@[^@]+\\.[^@]+$', maxLength: 255 },
    sanitize: { input: ['trim', 'lowercase', 'normalize(NFKC)'], output: ['htmlEscape'] },
    hints: { en: { placeholder: 'user@example.com', help: 'Email address', error: { format: 'Invalid email', required: 'Required' } } },
    tiers: { vibe: { validation: { regex: '^[^@]+@[^@]+\\.[^@]+$', maxLength: null }, sanitize: ['trim', 'lowercase'], hints: { en: { placeholder: 'user@example.com' } } } },
    security: { encrypt: false },
  },
  {
    name: 'icd10',
    match: { sql: "column_name LIKE '%diagnosis%' OR column_name LIKE '%icd%' OR column_name LIKE '%code%'", maxLength: 8 },
    validation: { regex: '^[A-Z]\\d{2}(\\.\\d{1,4})?$', maxLength: 8 },
    sanitize: { input: ['trim', 'uppercase', 'normalize(NFKC)'], output: ['htmlEscape'] },
    hints: { en: { placeholder: 'J45.901', help: 'ICD-10 code', error: { format: 'Invalid ICD-10', required: 'Required' } } },
    tiers: { vibe: { validation: { regex: '^[A-Z]\\d{2}(\\.\\d{1,4})?$', maxLength: null }, sanitize: ['trim', 'uppercase'], hints: { en: { placeholder: 'J45.901' } } } },
    security: { encrypt: true, notes: ['PHI'] },
  },
  {
    name: 'zip5',
    match: { sql: "column_name LIKE '%zip%' OR column_name LIKE '%postal%'", maxLength: 5 },
    validation: { regex: '^\\d{5}$', maxLength: 5 },
    sanitize: { input: ['trim', 'stripNonDigits', 'normalize(NFKC)'], output: ['htmlEscape'] },
    hints: { en: { placeholder: '90210', help: '5-digit ZIP', error: { format: 'Must be 5 digits', required: 'Required' } } },
    tiers: { vibe: { validation: { regex: '^\\d{5}$', maxLength: null }, sanitize: ['trim', 'htmlEscape'], hints: { en: { placeholder: '90210' } } } },
    security: { encrypt: false },
  },
  {
    name: 'us-phone',
    match: { sql: "column_name LIKE '%phone%' AND data_type IN ('varchar(20)', 'varchar(15)')", maxLength: 15 },
    validation: { regex: '^\\+1\\d{10}$', maxLength: 15 },
    sanitize: { input: ['stripNonDigits', 'normalize(NFKC)'], output: ['htmlEscape'] },
    hints: { en: { placeholder: '+1 (555) 123-4567', help: 'US phone', error: { format: 'Invalid phone', required: 'Required' } } },
    tiers: { vibe: { validation: { regex: '^\\+1\\d{10}$', maxLength: null }, sanitize: ['stripNonDigits'], hints: { en: { placeholder: '+1 (555) 123-4567' } } } },
    security: { encrypt: false },
  },
  {
    name: 'full-name',
    match: { sql: "column_name LIKE '%name%' OR column_name LIKE '%full_name%'", maxLength: 100 },
    validation: { maxLength: 100 },
    sanitize: { input: ['trim', 'collapseWhitespace', 'normalize(NFKC)'], output: ['htmlEscape'] },
    hints: { en: { placeholder: 'Jane Doe', help: 'Full name', error: { format: '1-100 chars', required: 'Required' } } },
    tiers: { vibe: { validation: { regex: null, maxLength: 100 }, sanitize: ['trim', 'collapseWhitespace'], hints: { en: { placeholder: 'Jane Doe' } } } },
    security: { encrypt: false },
  },
  {
    name: 'text',
    match: { },
    validation: { },
    sanitize: { input: ['trim', 'collapseWhitespace', 'normalize(NFKC)'], output: ['htmlEscape'] },
    hints: { en: { placeholder: 'Enter text...', help: '', error: { format: '', required: 'Required' } } },
    tiers: { vibe: { validation: { regex: null, maxLength: null }, sanitize: ['trim'], hints: { en: { placeholder: 'Enter text...' } } } },
    security: { encrypt: false },
  },
]

describe('matchColumnToTypeSync', () => {
  it('matches email column to email type', () => {
    const col: ColumnInfo = { columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, mockTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('email')
    expect(result!.confidence).toBeGreaterThan(0)
  })

  it('matches diagnosis column to icd10 type', () => {
    const col: ColumnInfo = { columnName: 'diagnosis', dataType: 'varchar', isNullable: true, maxLength: 8, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, mockTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('icd10')
  })

  it('matches icd_code column to icd10 type', () => {
    const col: ColumnInfo = { columnName: 'icd_code', dataType: 'varchar', isNullable: true, maxLength: 8, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, mockTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('icd10')
  })

  it('matches zip column to zip5 type', () => {
    const col: ColumnInfo = { columnName: 'zip', dataType: 'varchar', isNullable: true, maxLength: 5, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, mockTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('zip5')
  })

  it('matches phone column to us-phone type', () => {
    const col: ColumnInfo = { columnName: 'phone', dataType: 'varchar', isNullable: true, maxLength: 20, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, mockTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('us-phone')
  })

  it('matches name column to full-name type', () => {
    const col: ColumnInfo = { columnName: 'name', dataType: 'varchar', isNullable: false, maxLength: 100, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, mockTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('full-name')
  })

  it('matches full_name column to full-name type', () => {
    const col: ColumnInfo = { columnName: 'full_name', dataType: 'varchar', isNullable: true, maxLength: 100, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, mockTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('full-name')
  })

  it('falls back to text for unknown columns', () => {
    const col: ColumnInfo = { columnName: 'description', dataType: 'text', isNullable: true, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, mockTypes)
    expect(result).not.toBeNull()
    expect(result!.type.name).toBe('text')
  })

  it('returns higher confidence for more specific matches', () => {
    const emailCol: ColumnInfo = { columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const descCol: ColumnInfo = { columnName: 'description', dataType: 'text', isNullable: true, maxLength: null, defaultValue: null, isPrimaryKey: false, foreignKey: null }

    const emailResult = matchColumnToTypeSync(emailCol, mockTypes)
    const descResult = matchColumnToTypeSync(descCol, mockTypes)

    expect(emailResult!.confidence).toBeGreaterThan(descResult!.confidence)
  })

  it('returns null for empty types array', () => {
    const col: ColumnInfo = { columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null }
    const result = matchColumnToTypeSync(col, [])
    expect(result).toBeNull()
  })
})