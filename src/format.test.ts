import { describe, it, expect } from 'vitest'
import { formatCode, formatGeneratedOutput, formatGeneratedStoreOutput } from './format'
import { generateForTier } from './generate'
import { generateStore } from './generate-store'
import { introspectSchemaFromDdl } from './introspect'

describe('formatCode', () => {
  it('formats TypeScript code', async () => {
    const input = 'const  x:number  =1'
    const result = await formatCode(input, 'typescript')
    expect(result).toContain('const x: number = 1')
    expect(result).not.toContain('  ')
  })

  it('formats HTML code', async () => {
    const input = '<div ><p>hello</p></div>'
    const result = await formatCode(input, 'html')
    expect(result).toContain('<div>')
  })

  it('returns original on failure', async () => {
    const result = await formatCode('not valid >>> code {{{', 'typescript')
    expect(result).toBe('not valid >>> code {{{')
  })
})

describe('formatGeneratedOutput', () => {
  it('formats generateForTier output', async () => {
    const ddl = `CREATE TABLE test (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL);`
    const schema = introspectSchemaFromDdl(ddl)
    const output = generateForTier(schema, { tier: 'vibe', component: 'form' })
    const formatted = await formatGeneratedOutput(output)

    expect(formatted.formattedRoutes).toBeTruthy()
    expect(formatted.formattedRoutes.length).toBeGreaterThanOrEqual(output.routes.length)
    expect(formatted.formattedTemplate).toContain('<form')
  })
})

describe('formatGeneratedStoreOutput', () => {
  it('formats generateStore output', async () => {
    const cols = [
      { columnName: 'id', dataType: 'uuid', isNullable: false, maxLength: null, defaultValue: null, isPrimaryKey: true, foreignKey: null },
      { columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null },
    ]
    const output = generateStore({ tableName: 'users', columns: cols, tier: 'production' })
    const formatted = await formatGeneratedStoreOutput(output)

    expect(formatted.formattedFullCode).toBeTruthy()
    expect(formatted.formattedFullCode).toContain('createEntityStore')
    expect(formatted.formattedFullCode).toContain('sure-state')
  })
})
