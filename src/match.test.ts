import { describe, it, expect } from 'vitest'
import type { ColumnInfo } from './introspect.js'
import type { CatalogType } from './types.js'
import { matchColumnToTypeSync, loadAllTypesSync } from './match.js'

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
// A column whose name matches nothing must not be assigned a specific type
// just because its length happens to fit. The maxLength rule is a tie-breaker
// between types that already matched, never a way to start a match.
describe('matchColumnToTypeSync: length alone cannot select a type', () => {
  const column = (columnName: string, dataType: string, maxLength: number | null): ColumnInfo => ({
    columnName,
    dataType,
    isNullable: true,
    maxLength,
    defaultValue: null,
    isPrimaryKey: false,
    foreignKey: null,
  })

  it('falls back to text for a name no type claims', () => {
    const types = loadAllTypesSync()
    // varchar(40) fits inside email/password/url maxLength, but none of those
    // rules match the name "plan" — the result must not be one of them.
    const matched = matchColumnToTypeSync(column('plan', 'varchar', 40), types, 'production')
    expect(matched, 'a length-only match assigned a specific type').not.toBeNull()
    const confident = matched!.type.name
    expect(['email', 'password', 'url', 'us-address', 'full-name', 'credit-card', 'icd10', 'zip5', 'zip9', 'us-phone', 'date-us'])
      .not.toContain(confident)
  })

  it('still matches a name a type claims, even when the length also fits', () => {
    const types = loadAllTypesSync()
    expect(matchColumnToTypeSync(column('email', 'varchar', 255), types, 'production')!.type.name).toBe('email')
    // A real DATE column is ISO-validated; date-us is for MM/DD/YYYY text.
    expect(matchColumnToTypeSync(column('signup_date', 'date', null), types, 'production')!.type.name).toBe('date-iso')
  })

  it('does not let a length bonus create a match at all', () => {
    const types = loadAllTypesSync()
    // Every named type needs a name or data_type match. Anything reached only
    // by the maxLength bonus is a false positive.
    for (const name of ['plan', 'status', 'notes', 'token', 'version']) {
      const matched = matchColumnToTypeSync(column(name, 'varchar', 20), types, 'production')
      const result = matched?.type.name ?? 'text'
      expect(['text'], `${name} (varchar 20) was matched as ${result}`).toContain(result)
    }
  })
})

/**
 * The obvious first call to this function is a bare column name, because
 * "which type is this column?" is the whole question it answers. That threw a
 * `TypeError` from inside the scoring loop — `column.columnName.toLowerCase()`
 * on a string — which told a caller nothing about what was expected.
 */
describe('matchColumnToTypeSync: accepts a bare column name', () => {
  it('matches a name with no ColumnInfo', () => {
    const types = loadAllTypesSync()
    expect(matchColumnToTypeSync('email', types)!.type.name).toBe('email')
    expect(matchColumnToTypeSync('ssn', types)!.type.name).toBe('ssn')
  })

  it('agrees with the full ColumnInfo when the name is unambiguous', () => {
    const types = loadAllTypesSync()
    const column = (columnName: string, dataType: string, maxLength: number | null): ColumnInfo => ({
      columnName, dataType, isNullable: true, maxLength, defaultValue: null, isPrimaryKey: false, foreignKey: null,
    })
    // Widths a real column would have: a 255-character "phone" is not a phone,
    // so the catalogue is expected to disagree on that one.
    const widths: Record<string, number> = { email: 255, ssn: 11, phone: 15, zip: 5 }
    for (const name of ['email', 'ssn', 'phone', 'zip']) {
      const bare = matchColumnToTypeSync(name, types)
      const full = matchColumnToTypeSync(column(name, 'varchar', widths[name]!), types)
      expect(bare?.type.name, name).toBe(full?.type.name)
    }
  })

  it('returns null rather than guessing when a data_type rule is the only match', () => {
    // A name alone carries no data type, so a type whose only rule is on
    // data_type must not be selected — otherwise every name would match it.
    const types = loadAllTypesSync()
    const result = matchColumnToTypeSync('created_at', types)
    expect(result?.type.name ?? 'text').toBe('text')
  })

  it('explains itself when given something that is not a column', () => {
    const types = loadAllTypesSync()
    // The message has to name the fix, not just the type.
    for (const bad of [null, undefined, '', 42, {}]) {
      expect(() => matchColumnToTypeSync(bad as never, types)).toThrow(/ColumnInfo from the schema/)
    }
  })

  it('tolerates a partial ColumnInfo rather than failing mid-loop', () => {
    const types = loadAllTypesSync()
    // { columnName } with no dataType read `.toLowerCase()` on undefined.
    expect(matchColumnToTypeSync({ columnName: 'email' } as never, types)!.type.name).toBe('email')
  })
})

describe('matching honours the data_type a rule declares', () => {
  const types = loadAllTypesSync()
  const column = (columnName: string, dataType: string, maxLength: number | null = null): ColumnInfo => ({
    columnName,
    dataType,
    isNullable: true,
    maxLength,
    defaultValue: null,
    isPrimaryKey: false,
    foreignKey: null,
  })

  it('does not put an MM/DD/YYYY rule on a timestamp named like a date', () => {
    // The name contains "date"; the type is not varchar(10).
    const result = matchColumnToTypeSync(column('updated_at', 'TIMESTAMPTZ'), types, 'production')
    expect(result?.type.name ?? 'text').not.toBe('date-us')
  })

  it('matches a real DATE column to the ISO type', () => {
    expect(matchColumnToTypeSync(column('signup_date', 'date'), types, 'production')!.type.name).toBe('date-iso')
  })

  it('keeps the US-phone rule on phone-width columns only', () => {
    expect(matchColumnToTypeSync(column('home_phone', 'varchar', 15), types, 'production')!.type.name).toBe('us-phone')
    expect(matchColumnToTypeSync(column('home_phone', 'varchar', 200), types, 'production')!.type.name).not.toBe('us-phone')
  })

  it('does not read "account" as a credit-card column', () => {
    for (const name of ['account_number', 'po_present_acct', 'payoff_balance']) {
      const result = matchColumnToTypeSync(column(name, 'numeric'), types, 'production')
      expect(result?.type.name ?? 'text', name).not.toBe('credit-card')
    }
  })

  it('still matches a genuinely named card column', () => {
    for (const name of ['card_number', 'credit_card', 'cc_number']) {
      expect(matchColumnToTypeSync(column(name, 'varchar', 19), types, 'production')!.type.name, name).toBe('credit-card')
    }
  })
})
