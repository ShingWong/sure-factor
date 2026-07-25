const DIRECTION_OVERRIDE_RE = /[\u202E\u202D\u2066\u2067\u2068\u2069]/g
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g
const HTML_ENTITY_RE = /[&<>"'/]/g

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
}

export function normalize(str: string, form: string = 'NFKC'): string {
  return str.normalize(form as 'NFC' | 'NFD' | 'NFKC' | 'NFKD')
}

export function stripDirectionOverrides(str: string): string {
  return str.replace(DIRECTION_OVERRIDE_RE, '')
}

export function stripZeroWidth(str: string): string {
  return str.replace(ZERO_WIDTH_RE, '')
}

export function stripControl(str: string): string {
  return str.replace(CONTROL_CHARS_RE, '')
}

export function trim(str: string): string {
  return str.trim()
}

export function uppercase(str: string): string {
  return str.toUpperCase()
}

export function lowercase(str: string): string {
  return str.toLowerCase()
}

export function stripNonDigits(str: string): string {
  return str.replace(/\D/g, '')
}

export function collapseWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim()
}

export function htmlEscape(str: string): string {
  return str.replace(HTML_ENTITY_RE, c => HTML_ESCAPE_MAP[c] ?? c)
}

export function slice(str: string, start: number, end?: number): string {
  return str.slice(start, end)
}

type SanitizeStep =
  | 'trim'
  | 'lowercase'
  | 'uppercase'
  | 'htmlEscape'
  | 'stripNonDigits'
  | 'collapseWhitespace'
  | 'stripControl'
  | 'stripDirectionOverrides'
  | 'stripZeroWidth'
  | { normalize: string }
  | { slice: [number, number?] }

function parseStep(step: string): { fn: (s: string) => string } | null {
  const paramMatch = step.match(/^(\w+)\(([^)]*)\)$/)
  if (paramMatch) {
    const name = paramMatch[1]!
    const args = paramMatch[2]!.split(',').map(s => s.trim()).filter(Boolean)
    switch (name) {
      case 'normalize':
        return { fn: (s: string) => normalize(s, args[0] ?? 'NFKC') }
      case 'slice':
        return { fn: (s: string) => slice(s, Number(args[0] ?? 0), args[1] !== undefined ? Number(args[1]) : undefined) }
      default:
        return null
    }
  }

  switch (step) {
    case 'trim': return { fn: trim }
    case 'lowercase': return { fn: lowercase }
    case 'uppercase': return { fn: uppercase }
    case 'htmlEscape': return { fn: htmlEscape }
    case 'stripNonDigits': return { fn: stripNonDigits }
    case 'collapseWhitespace': return { fn: collapseWhitespace }
    case 'stripControl': return { fn: stripControl }
    case 'stripDirectionOverrides': return { fn: stripDirectionOverrides }
    case 'stripZeroWidth': return { fn: stripZeroWidth }
    default: return null
  }
}

export function sanitize(value: string, steps: string[]): string {
  let result = value
  for (const step of steps) {
    const parsed = parseStep(step)
    if (parsed) {
      result = parsed.fn(result)
    }
  }
  return result
}

export function sanitizeInput(value: string, maxLength?: number | null): string {
  let result = value
  result = normalize(result, 'NFKC')
  result = stripDirectionOverrides(result)
  result = stripZeroWidth(result)
  result = stripControl(result)
  result = trim(result)
  if (maxLength != null && maxLength > 0) {
    result = slice(result, 0, maxLength)
  }
  return result
}

export function sanitizeOutput(value: string, richText: boolean = false): string {
  if (richText) {
    return value
  }
  return htmlEscape(value)
}
