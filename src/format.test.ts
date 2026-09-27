import { describe, it, expect, vi } from 'vitest'
import { formatCode, formatGeneratedOutput, formatGeneratedStoreOutput } from './format.js'
import { generateForTier } from './generate.js'
import { generateStore } from './generate-store.js'
import { introspectSchemaFromDdl } from './introspect.js'

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

  it('warns when input could not be parsed instead of failing silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await formatCode('not valid >>> code {{{', 'typescript')
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0]![0])).toContain('could not parse')
    warn.mockRestore()
  })

  it('does not warn when formatting succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await formatCode('const  x:number  =1', 'typescript')
    expect(result).toContain('const x: number = 1')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('handles concurrent calls without duplicate import failures', async () => {
    // The module promise is memoized, so concurrent callers share one import
    // rather than each starting (and each failing) their own.
    const results = await Promise.all([
      formatCode('const a=1', 'typescript'),
      formatCode('const b=2', 'typescript'),
      formatCode('const c=3', 'typescript'),
    ])
    for (const r of results) expect(r).toContain('const')
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
