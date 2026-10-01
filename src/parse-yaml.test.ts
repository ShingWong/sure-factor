
import { describe, it, expect } from 'vitest'
import { parseYaml } from './parse-yaml.js'
import { loadAllTypesSync } from './match.js'

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

// Flow collections must only split on top-level commas. A regex quantifier
// like {0,61} contains a comma, and a character class can contain a slash —
// both previously truncated the value.
describe('parseYaml flow collections', () => {
  it('keeps a comma inside a regex quantifier within a flow mapping', () => {
    const yaml = 'validation: { regex: "a{0,61}b", maxLength: 5 }'
    expect((parseYaml(yaml) as any).validation.regex).toBe('a{0,61}b')
  })

  it('keeps an unquoted comma inside a quantifier', () => {
    const yaml = 'validation: { regex: x{0,61}y, maxLength: 5 }'
    expect((parseYaml(yaml) as any).validation.regex).toBe('x{0,61}y')
  })

  it('keeps a slash inside a character class', () => {
    const yaml = "validation: { regex: '[a-zA-Z0-9.!#$%&*+/=?]+', maxLength: 5 }"
    expect((parseYaml(yaml) as any).validation.regex).toBe('[a-zA-Z0-9.!#$%&*+/=?]+')
  })

  it('still splits ordinary pairs', () => {
    const yaml = 'validation: { regex: abc, maxLength: 5 }'
    expect((parseYaml(yaml) as any).validation).toEqual({ regex: 'abc', maxLength: 5 })
  })

  it('still splits inline arrays on top-level commas', () => {
    expect((parseYaml('steps: [a, b, c]') as any).steps).toEqual(['a', 'b', 'c'])
  })

  it('round-trips the email catalog regex through a tier block', () => {
    const yaml = [
      'tiers:',
      '  production:',
      "    validation: { regex: ^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$, maxLength: 254 }",
    ].join('\n')
    const regex = ((parseYaml(yaml) as any).tiers.production.validation as any).regex
    expect(regex).toBe(
      "^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"
    )
    expect((parseYaml(yaml) as any).tiers.production.validation.maxLength).toBe(254)
    expect(() => new RegExp(regex)).not.toThrow()
  })
})

describe('parseYaml inline arrays with call arguments', () => {
  it('keeps slice(0, maxLength) whole inside an inline array', () => {
    expect((parseYaml('sanitize: [trim, slice(0, maxLength)]') as any).sanitize)
      .toEqual(['trim', 'slice(0, maxLength)'])
  })

  it('still splits ordinary inline array items', () => {
    expect((parseYaml('s: [a, b, c]') as any).s).toEqual(['a', 'b', 'c'])
  })

  it('keeps every catalog sanitisation step intact', () => {
    for (const t of loadAllTypesSync()) {
      for (const step of t.sanitize?.input ?? []) {
        expect(Array.isArray(step), `${t.name} has a split step: ${JSON.stringify(step)}`).toBe(false)
      }
    }
  })
})
