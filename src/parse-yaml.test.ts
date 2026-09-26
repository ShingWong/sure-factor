
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

    const generated = result!.generated as Record<string, string>
    expect(typeof generated.html).toBe('string')
    expect(generated.html).toContain('sure-dialog')
    expect(generated.js).toContain('openModal')
    expect(generated.css).toContain('sure-dialog-overlay')
  })
})
