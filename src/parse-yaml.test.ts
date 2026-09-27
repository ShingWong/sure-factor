
import { describe, it, expect } from 'vitest'
import { parseYaml } from './parse-yaml.js'

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

describe('block arrays of objects', () => {
  it('keeps every sibling object item, not just the first', () => {
    const result = parseYaml(
      ['parameters:', '  fields:', '    - name: email', '      type: email', '    - name: password', '      type: password', ''].join('\n')
    )
    expect(result).toEqual({
      parameters: {
        fields: [
          { name: 'email', type: 'email' },
          { name: 'password', type: 'password' },
        ],
      },
    })
  })

  it('keeps object items that follow a scalar item', () => {
    const result = parseYaml(['items:', '  - plain', '  - name: a', '  - name: b', ''].join('\n'))
    expect(result).toEqual({ items: ['plain', { name: 'a' }, { name: 'b' }] })
  })

  it('restores the outer array after a nested block array ends', () => {
    const result = parseYaml(
      [
        'columns:',
        '  - name: first',
        '    tags:',
        '      - x',
        '      - y',
        '  - name: second',
        '',
      ].join('\n')
    )
    expect(result).toEqual({
      columns: [
        { name: 'first', tags: ['x', 'y'] },
        { name: 'second' },
      ],
    })
  })

  it('closes a block array when a sibling key follows it', () => {
    const result = parseYaml(['list:', '  - name: a', 'after: done', ''].join('\n'))
    expect(result).toEqual({ list: [{ name: 'a' }], after: 'done' })
  })

  it('round-trips every object item in the shipped component catalog', async () => {
    const { readFileSync, readdirSync } = await import('fs')
    const dir = './catalog/components'
    const files = readdirSync(dir).filter(f => f.endsWith('.yaml'))
    expect(files.length).toBeGreaterThan(0)

    const countObjects = (node: unknown): number => {
      if (Array.isArray(node)) {
        return node.reduce<number>(
          (n, v) => n + (v !== null && typeof v === 'object' && !Array.isArray(v) ? 1 : 0) + countObjects(v),
          0
        )
      }
      if (node !== null && typeof node === 'object') {
        return Object.values(node).reduce<number>((n, v) => n + countObjects(v), 0)
      }
      return 0
    }

    for (const file of files) {
      const text = readFileSync(`${dir}/${file}`, 'utf-8')
      const declared = (text.match(/^\s*-\s+[A-Za-z_$][\w$]*\s*:(?:\s|$)/gm) ?? []).length
      expect(countObjects(parseYaml(text)), `${file} dropped array items`).toBe(declared)
    }
  })
})
