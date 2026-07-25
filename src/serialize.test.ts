import { describe, it, expect } from 'vitest'
import { toYaml, toJson, fromJson, toMarkdown, toXml, fromXml, convert } from './serialize'
import { parseYaml } from './parse-yaml'

const zip5data: Record<string, unknown> = {
  name: 'zip5',
  description: '5-digit US ZIP code',
  match: {
    sql: "column_name LIKE '%zip%' OR column_name LIKE '%postal%'",
    regex: '^\\d{5}$',
    maxLength: 5,
  },
  validation: { regex: '^\\d{5}$', maxLength: 5, lookup: null },
  sanitize: {
    input: ['trim', 'stripNonDigits', 'normalize(NFKC)', 'slice(0, 5)'],
    output: ['htmlEscape'],
  },
  hints: {
    en: { placeholder: '90210', help: '5-digit US ZIP code', error: { format: 'Must be exactly 5 digits', required: 'ZIP code is required' } },
  },
  security: { encrypt: false, notes: [] },
}

describe('toYaml', () => {
  it('serializes simple key-value pairs', () => {
    const result = toYaml({ name: 'test', value: 42 })
    expect(result).toContain('name: test')
    expect(result).toContain('value: 42')
  })

  it('serializes nested objects', () => {
    const result = toYaml(zip5data)
    expect(result).toContain('match:')
    expect(result).toContain('sql:')
    expect(result).toContain("column_name LIKE '%zip%' OR column_name LIKE '%postal%'")
    expect(result).toContain('maxLength: 5')
  })

  it('serializes arrays', () => {
    const result = toYaml({ items: ['a', 'b', 'c'] })
    expect(result).toContain('- a')
    expect(result).toContain('- b')
    expect(result).toContain('- c')
  })

  it('serializes booleans and null', () => {
    const result = toYaml({ flag: true, empty: null })
    expect(result).toContain('flag: true')
    expect(result).toContain('empty: null')
  })

  it('produces parseable YAML', () => {
    const yaml = toYaml(zip5data)
    const reparsed = parseYaml(yaml)
    expect(reparsed).not.toBeNull()
    expect(reparsed!.name).toBe('zip5')
    expect((reparsed!.match as Record<string, unknown>).maxLength).toBe(5)
  })
})

describe('toJson / fromJson', () => {
  it('converts data to JSON', () => {
    const json = toJson(zip5data)
    const parsed = JSON.parse(json)
    expect(parsed.name).toBe('zip5')
    expect(parsed.match.maxLength).toBe(5)
  })

  it('parses JSON back to object', () => {
    const json = JSON.stringify(zip5data)
    const data = fromJson(json)
    expect(data.name).toBe('zip5')
    expect((data.match as Record<string, unknown>).sql).toContain('zip%')
  })

  it('roundtrips YAML → JSON → YAML', () => {
    const yaml1 = toYaml(zip5data)
    const parsed = parseYaml(yaml1)!
    const json = toJson(parsed)
    const fromJsonData = fromJson(json)
    const yaml2 = toYaml(fromJsonData)
    expect(yaml2.replace(/\s+/g, ' ')).toBe(yaml1.replace(/\s+/g, ' '))
  })
})

describe('toMarkdown', () => {
  it('generates markdown with title', () => {
    const md = toMarkdown(zip5data)
    expect(md).toContain('# zip5')
    expect(md).toContain('5-digit US ZIP code')
  })

  it('includes section headings', () => {
    const md = toMarkdown(zip5data)
    expect(md).toContain('## Match')
    expect(md).toContain('## Validation')
    expect(md).toContain('## Sanitize')
    expect(md).toContain('## Security')
  })

  it('includes field values in backticks', () => {
    const md = toMarkdown(zip5data)
    expect(md).toContain('`^\\d{5}$`')
    expect(md).toContain('`false`')
  })

  it('handles component data', () => {
    const compData: Record<string, unknown> = {
      name: 'form',
      description: 'A basic form',
      parameters: {
        fields: [{ name: 'email', type: 'email' }],
      },
    }
    const md = toMarkdown(compData)
    expect(md).toContain('# form')
    expect(md).toContain('## Parameters')
  })
})

describe('toXml / fromXml', () => {
  it('generates XML with declaration and root', () => {
    const xml = toXml({ name: 'test' }, { rootName: 'type' })
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<type>')
    expect(xml).toContain('<name>test</name>')
    expect(xml).toContain('</type>')
  })

  it('serializes nested objects to nested XML', () => {
    const xml = toXml(zip5data, { rootName: 'type' })
    expect(xml).toContain('<match>')
    expect(xml).toContain('<sql>')
    expect(xml).toContain('<maxLength>5</maxLength>')
    expect(xml).toContain('</match>')
  })

  it('serializes arrays as repeated elements', () => {
    const xml = toXml({ items: ['a', 'b'] }, { rootName: 'root' })
    const matches = xml.match(/<items>/g)
    expect(matches).toHaveLength(2)
  })

  it('parses XML back to object', () => {
    const xml = `<type><name>test</name><value>42</value></type>`
    const data = fromXml(xml)
    expect(data.name).toBe('test')
    expect(data.value).toBe(42)
  })

  it('parses nested XML', () => {
    const xml = `<root><match><sql>LIKE '%x%'</sql><maxLength>5</maxLength></match></root>`
    const data = fromXml(xml)
    const match = data.match as Record<string, unknown>
    expect(match.sql).toBe("LIKE '%x%'")
    expect(match.maxLength).toBe(5)
  })

  it('handles self-closing tags as null', () => {
    const xml = `<root><empty/><name>val</name></root>`
    const data = fromXml(xml)
    expect(data.empty).toBeNull()
    expect(data.name).toBe('val')
  })

  it('roundtrips YAML → XML → YAML (data preserved)', () => {
    const simple = { name: 'zip5', match: { sql: "LIKE '%zip%'", maxLength: 5 } }
    const xml = toXml(simple, { rootName: 'type' })
    const parsed = fromXml(xml)
    expect(parsed.name).toBe('zip5')
    const match = parsed.match as Record<string, unknown>
    expect(match.sql).toBe("LIKE '%zip%'")
    expect(match.maxLength).toBe(5)
  })
})

describe('convert', () => {
  const yamlInput = `name: test
value: 42
nested:
  key: hello
`

  it('converts YAML to JSON', () => {
    const result = convert(yamlInput, 'yaml', 'json')
    const parsed = JSON.parse(result)
    expect(parsed.name).toBe('test')
    expect(parsed.value).toBe(42)
    expect(parsed.nested.key).toBe('hello')
  })

  it('converts YAML to Markdown', () => {
    const result = convert(yamlInput, 'yaml', 'md')
    expect(result).toContain('# test')
    expect(result).toContain('## Nested')
  })

  it('converts JSON to YAML', () => {
    const json = JSON.stringify({ name: 'test', value: 42 })
    const result = convert(json, 'json', 'yaml')
    expect(result).toContain('name: test')
    expect(result).toContain('value: 42')
  })

  it('converts YAML to XML', () => {
    const result = convert(yamlInput, 'yaml', 'xml')
    expect(result).toContain('<?xml')
    expect(result).toContain('<name>test</name>')
    expect(result).toContain('<value>42</value>')
  })

  it('converts XML to JSON', () => {
    const xml = '<root><name>test</name><value>42</value></root>'
    const result = convert(xml, 'xml', 'json')
    const parsed = JSON.parse(result)
    expect(parsed.name).toBe('test')
    expect(parsed.value).toBe(42)
  })

  it('throws for unsupported formats', () => {
    expect(() => convert('', 'yaml', 'pdf' as any)).toThrow()
  })

  it('returns empty object for non-YAML input', () => {
    const result = convert('not valid yaml {{{', 'yaml', 'json')
    expect(JSON.parse(result)).toEqual({})
  })
})

describe('real catalog data', () => {
  it('converts zip5.yaml to JSON preserving structure', () => {
    const yaml = toYaml(zip5data)
    const parsed = parseYaml(yaml)!
    const json = toJson(parsed)
    const data = JSON.parse(json)
    expect(data.name).toBe('zip5')
    expect(data.match.sql).toContain('zip%')
    expect(data.validation.maxLength).toBe(5)
    expect(data.sanitize.input).toContain('trim')
    expect(data.hints.en.placeholder).toBe('90210')
    expect(data.security.encrypt).toBe(false)
  })

  it('converts zip5.yaml to XML preserving structure', () => {
    const parsed = parseYaml(toYaml(zip5data))!
    const xml = toXml(parsed, { rootName: 'type' })
    expect(xml).toContain('<name>zip5</name>')
    expect(xml).toContain('<maxLength>5</maxLength>')
    expect(xml).toContain('<encrypt>false</encrypt>')
    expect(xml).toContain('<placeholder>90210</placeholder>')
  })

  it('converts zip5.yaml to Markdown with all sections', () => {
    const parsed = parseYaml(toYaml(zip5data))!
    const md = toMarkdown(parsed)
    expect(md).toContain('# zip5')
    expect(md).toContain('## Match')
    expect(md).toContain('## Validation')
    expect(md).toContain('## Sanitize')
    expect(md).toContain('## Hints')
    expect(md).toContain('## Security')
    expect(md).toContain('`false`')
  })
})
