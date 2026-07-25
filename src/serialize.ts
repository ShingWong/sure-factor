import { parseYaml } from './parse-yaml'

export interface ConvertOptions {
  rootName?: string
  kind?: 'type' | 'component'
  pretty?: boolean
}

function serializeYamlValue(val: unknown, indent: number): string {
  const pad = '  '.repeat(indent)
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') {
    const looksLikeNumber = /^\d+\.?\d*$/.test(val) || /^\.\d+$/.test(val)
    const looksLikeBool = val === 'true' || val === 'false' || val === 'null' || val === '~' || val === 'yes' || val === 'no' || val === 'on' || val === 'off'
    if (val === '' || val.includes(': ') || val.startsWith('[') || val.startsWith('{') || val.startsWith('#') || val.includes('\n') || looksLikeNumber || looksLikeBool) {
      return `'${val.replace(/'/g, "''")}'`
    }
    return val
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]'
    return '\n' + val.map(v => `${pad}- ${serializeYamlValue(v, indent + 1)}`).join('\n')
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return '{}'
    return '\n' + keys.map(k => {
      const v = obj[k]
      const prefix = `${pad}${k}:`
      const vs = serializeYamlValue(v, indent + 1)
      if (vs.startsWith('\n') || vs === '[]' || vs === '{}') {
        return `${prefix}${vs}`
      }
      return `${prefix} ${vs}`
    }).join('\n')
  }
  return String(val)
}

export function toYaml(data: Record<string, unknown>): string {
  return serializeYamlValue(data, 0).trimStart() + '\n'
}

export function toJson(data: Record<string, unknown>, pretty: boolean = true): string {
  return JSON.stringify(data, null, pretty ? 2 : undefined) + '\n'
}

export function fromJson(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>
}

function mdValue(v: unknown): string {
  if (v === null || v === undefined) return '*null*'
  if (typeof v === 'boolean') return v ? '`true`' : '`false`'
  if (typeof v === 'number') return `\`${v}\``
  if (typeof v === 'string') return `\`${v}\``
  if (Array.isArray(v)) return v.map(mdValue).join(', ')
  return '`' + JSON.stringify(v) + '`'
}

function mdKeyValue(key: string, val: unknown, depth: number): string {
  const heading = '#'.repeat(depth + 2)
  if (Array.isArray(val)) {
    const items = val.map((v, i) => `${i + 1}. ${typeof v === 'object' && v !== null ? mdSection(v as Record<string, unknown>, depth + 1) : mdValue(v)}`).join('\n')
    return `\n${heading} ${capitalize(key)}\n\n${items}\n`
  }
  if (typeof val === 'object' && val !== null) {
    return mdSection(val as Record<string, unknown>, depth + 1)
  }
  return `- **${key}:** ${mdValue(val)}\n`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function mdSection(obj: Record<string, unknown>, depth: number): string {
  const lines: string[] = []
  const keys = Object.keys(obj)
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const heading = '#'.repeat(Math.min(depth + 2, 6))
      lines.push(`\n${heading} ${capitalize(key)}\n`)
      lines.push(mdSection(val as Record<string, unknown>, depth + 1))
    } else {
      lines.push(mdKeyValue(key, val, depth))
    }
  }
  return lines.join('')
}

export function toMarkdown(data: Record<string, unknown>, options: ConvertOptions = {}): string {
  const name = data.name ?? 'Untitled'
  const description = data.description ? `\n${data.description}\n` : ''
  const lines: string[] = [
    `# ${name}`,
    description,
  ]
  const sectionKeys = Object.keys(data).filter(k => !['name', 'description'].includes(k))
  for (const key of sectionKeys) {
    const val = data[key]
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      lines.push(`## ${capitalize(key)}\n`)
      lines.push(mdSection(val as Record<string, unknown>, 1))
    } else {
      lines.push(mdKeyValue(key, val, 0))
    }
  }
  return lines.join('') + '\n'
}

function xmlTag(name: string, val: unknown, depth: number): string {
  const pad = '  '.repeat(depth)
  if (val === null || val === undefined) return `${pad}<${name}/>\n`
  if (typeof val === 'boolean' || typeof val === 'number') {
    return `${pad}<${name}>${String(val)}</${name}>\n`
  }
  if (typeof val === 'string') {
    const escaped = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    return `${pad}<${name}>${escaped}</${name}>\n`
  }
  if (Array.isArray(val)) {
    return val.map(v => xmlTag(name, v, depth)).join('')
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return `${pad}<${name}/>\n`
    const inner = keys.map(k => xmlTag(k, obj[k], depth + 1)).join('')
    return `${pad}<${name}>\n${inner}${pad}</${name}>\n`
  }
  return `${pad}<${name}>${String(val)}</${name}>\n`
}

export function toXml(data: Record<string, unknown>, options: ConvertOptions = {}): string {
  const rootName = options.rootName ?? 'root'
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlTag(rootName, data, 0)}`
}

function parseXmlValue(text: string): unknown {
  if (text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  const num = Number(text)
  if (!Number.isNaN(num) && text !== '') return num
  return text
}

function parseXml(xml: string): Record<string, unknown> | null {
  try {
    const root: Record<string, unknown> = {}
    const tagStack: Array<{ name: string; obj: Record<string, unknown>; children: unknown[] }> = []
    const tagRe = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>|<(\w+)([^>]*)\/>/g
    let currentText = xml

    function extractTags(text: string): Record<string, unknown> {
      const result: Record<string, unknown> = {}
      const singleTagRe = /<(\w+)([^>]*?)\/>/g
      const pairTagRe = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g
      const finder = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>|<(\w+)([^>]*?)\/>/g
      let m: RegExpExecArray | null

      while ((m = finder.exec(text)) !== null) {
        const tagName = m[1] ?? m[4]!
        const content = m[3]
        const existing = result[tagName]
        const parsed = content !== undefined ? extractTags(content) : {}

        if (content !== undefined) {
          const textContent = content.replace(/<[^>]+>/g, '').trim()
          const hasNested = /<(\w+)/.test(content)

          let value: unknown
          if (hasNested) {
            value = parsed
            if (textContent && Object.keys(parsed).length === 0) {
              value = parseXmlValue(textContent)
            }
          } else {
            value = textContent ? parseXmlValue(textContent) : {}
          }

          if (existing !== undefined) {
            if (!Array.isArray(existing)) {
              result[tagName] = [existing]
            }
            (result[tagName] as unknown[]).push(value)
          } else {
            result[tagName] = value
          }
        } else {
          if (existing !== undefined) {
            if (!Array.isArray(existing)) {
              result[tagName] = [existing]
            }
            (result[tagName] as unknown[]).push(null)
          } else {
            result[tagName] = null
          }
        }
      }
      return result
    }

    const xmlDeclarationMatch = xml.match(/<\?xml[^>]+\?>/)
    const body = xmlDeclarationMatch ? xml.slice(xmlDeclarationMatch[0]!.length).trim() : xml.trim()

    const rootMatch = body.match(/^<(\w+)[^>]*>([\s\S]*)<\/\1>$/)
    if (!rootMatch) return root

    const inner = rootMatch[2]!
    return extractTags(inner)
  } catch {
    return null
  }
}

export function fromXml(xml: string): Record<string, unknown> {
  const result = parseXml(xml)
  if (!result) throw new Error('Failed to parse XML')
  return result
}

export type InputFormat = 'yaml' | 'json' | 'xml'
export type OutputFormat = 'yaml' | 'json' | 'md' | 'xml'

export function convert(input: string, inputFormat: InputFormat, outputFormat: OutputFormat, options: ConvertOptions = {}): string {
  let data: Record<string, unknown>

  switch (inputFormat) {
    case 'yaml': {
      const parsed = parseYaml(input)
      if (!parsed) throw new Error('Failed to parse YAML input')
      data = parsed
      break
    }
    case 'json':
      data = fromJson(input)
      break
    case 'xml':
      data = fromXml(input)
      break
    default:
      throw new Error(`Unsupported input format: ${inputFormat}`)
  }

  switch (outputFormat) {
    case 'yaml':
      return toYaml(data)
    case 'json':
      return toJson(data, options.pretty ?? true)
    case 'md':
      return toMarkdown(data, options)
    case 'xml':
      return toXml(data, options)
    default:
      throw new Error(`Unsupported output format: ${outputFormat}`)
  }
}
