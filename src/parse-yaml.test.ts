
import { describe, it, expect } from 'vitest'
import { parseYaml } from './parse-yaml'

describe('block scalars', () => {
  it('parses literal block scalar (|)', () => {
    const result = parseYaml('key: |\n  line one\n  line two\n')
    expect(result).toEqual({ key: 'line one\nline two' })
  })

  it('parses folded block scalar (>)', () => {
    const result = parseYaml('key: >\n  line one\n  line two\n')
    expect(result).toEqual({ key: 'line one line two' })
  })

  it('parses dialog component YAML with block scalars', async () => {
    const { readFileSync } = await import('fs')
    const yaml = readFileSync('./catalog/components/dialog.yaml', 'utf-8')
    const result = parseYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('dialog')
    expect(result!.generated).toBeDefined()
    expect(typeof result!.generated.html).toBe('string')
    expect(result!.generated.html).toContain('sure-dialog')
    expect(result!.generated.js).toContain('openModal')
    expect(result!.generated.css).toContain('sure-dialog-overlay')
  })
})
