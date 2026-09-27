// Bidi controls that reorder rendered text without being visible: the
// embedding/override/isolate set, the legacy explicit formatting set, and the
// left/right marks. U+061C is the Arabic Letter Mark and is just as invisible.
const DIRECTION_OVERRIDE_RE =
  /[\u202A-\u202E\u2066-\u2069\u061C\u200E\u200F\u206A-\u206F]/g
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g
// C0 controls plus DEL and the C1 range. \x09 (tab), \x0A (LF) and \x0D (CR)
// are deliberately excluded so line structure survives.
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g
const HTML_ENTITY_RE = /[&<>"'/]/g

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
}

const NORMALIZE_FORMS = ['NFC', 'NFD', 'NFKC', 'NFKD'] as const
export type NormalizeForm = (typeof NORMALIZE_FORMS)[number]

function isNormalizeForm(value: string): value is NormalizeForm {
  return (NORMALIZE_FORMS as readonly string[]).includes(value)
}

/**
 * Apply a Unicode normalization form. Falls back to NFKC for an unknown form
 * instead of letting `String.prototype.normalize` throw a RangeError, since the
 * form usually originates in free-form catalog or config text.
 */
export function normalize(str: string, form: string = 'NFKC'): string {
  if (!isNormalizeForm(form)) {
    console.warn(
      `[sanitize] unknown normalize form ${JSON.stringify(form)}; falling back to NFKC. ` +
        `Expected one of: ${NORMALIZE_FORMS.join(', ')}.`
    )
    return str.normalize('NFKC')
  }
  return str.normalize(form)
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

/**
 * Slice without leaving a dangling surrogate half.
 *
 * `String.prototype.slice` counts UTF-16 code units, so cutting at `maxLength`
 * can split an astral character (emoji, many CJK glyphs) and leave a lone
 * surrogate, which is malformed Unicode. Non-finite or non-integer bounds are
 * rejected rather than silently producing '' (NaN) or a reversed range.
 */
export function slice(str: string, start: number, end?: number): string {
  if (!Number.isFinite(start)) return str
  if (end !== undefined && !Number.isFinite(end)) return str
  const from = Math.trunc(start)
  const to = end === undefined ? undefined : Math.trunc(end)

  let out = from < 0 || to !== undefined ? str.slice(from, to) : str.substring(from)
  // If the cut landed on a high surrogate, drop it so the result stays valid.
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbbf) {
    out = out.slice(0, -1)
  }
  return out
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
    } else {
      // Skipping is the documented behaviour, but staying silent means a typo
      // silently disables sanitization. Surface it without changing behaviour.
      console.warn(
        `[sanitize] ignoring unknown step ${JSON.stringify(step)}; the value was left unmodified by it.`
      )
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

/** Tags permitted in rich-text output; everything else is dropped. */
const RICH_TEXT_ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'u', 'ul',
])

/** Attributes permitted per tag. Anything else, including every on* handler, is dropped. */
const RICH_TEXT_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'rel', 'target']),
  '*': new Set(['class', 'title']),
}

/** Elements whose content is code rather than prose; dropped with their body. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript'])

const UNSAFE_URL_SCHEME_RE = /^\s*(?:javascript|data|vbscript):/i

/** Escape a URL for an attribute value without mangling the path separator. */
function escapeAttributeUrl(value: string): string {
  return htmlEscape(value).replace(/&#x2F;/g, '/')
}

function sanitizeRichText(value: string): string {
  let out = ''
  let i = 0
  while (i < value.length) {
    const lt = value.indexOf('<', i)
    if (lt === -1) {
      out += htmlEscape(value.slice(i))
      break
    }
    out += htmlEscape(value.slice(i, lt))

    // Comments and doctype/CDATA are dropped wholesale.
    if (value.startsWith('<!--', lt)) {
      const end = value.indexOf('-->', lt + 4)
      i = end === -1 ? value.length : end + 3
      continue
    }

    const gt = value.indexOf('>', lt)
    if (gt === -1) {
      // Unterminated tag: treat the remainder as text.
      out += htmlEscape(value.slice(lt))
      break
    }

    const inner = value.slice(lt + 1, gt).trim()
    const closing = inner.startsWith('/')
    const selfClosing = inner.endsWith('/')
    const nameMatch = /^\/?\s*([A-Za-z][A-Za-z0-9-]*)/.exec(inner)
    const tag = nameMatch?.[1]?.toLowerCase() ?? ''

    if (!RICH_TEXT_ALLOWED_TAGS.has(tag)) {
      if (RAW_TEXT_ELEMENTS.has(tag)) {
        // script/style hold code, not prose: drop the element and its contents
        // so the body never resurfaces as visible text.
        const closeIdx = value.toLowerCase().indexOf(`</${tag}`, gt)
        i = closeIdx === -1 ? value.length : value.indexOf('>', closeIdx) + 1 || value.length
        if (i <= gt) i = value.length
        continue
      }
      // Drop the tag itself but keep any inner text.
      i = gt + 1
      continue
    }

    if (closing) {
      out += `</${tag}>`
      i = gt + 1
      continue
    }

    let attrs = ''
    const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let m: RegExpExecArray | null
    while ((m = attrRe.exec(inner.slice(nameMatch![0].length))) !== null) {
      const attr = m[1]!.toLowerCase()
      const rawValue = m[2] ?? m[3] ?? m[4] ?? ''
      const permitted = RICH_TEXT_ALLOWED_ATTRS[tag] ?? RICH_TEXT_ALLOWED_ATTRS['*']!
      if (!permitted.has(attr)) continue
      if (UNSAFE_URL_SCHEME_RE.test(rawValue)) continue
      // URL values are escaped conservatively, minus the separator, so a
      // legitimate href stays readable while quotes and angle brackets in an
      // attribute value can never break out of it.
      attrs += attr === 'href' || attr === 'src'
        ? ` ${attr}="${escapeAttributeUrl(rawValue)}"`
        : ` ${attr}="${htmlEscape(rawValue)}"`
    }

    out += selfClosing ? `<${tag}${attrs} />` : `<${tag}${attrs}>`
    i = gt + 1
  }
  return out
}

/**
 * Escape generated output for safe HTML insertion.
 *
 * `richText` is a promise that the value is already safe HTML, which nothing in
 * this package can enforce. Treating it as a bypass made it a fail-open XSS
 * hole for any caller passing untrusted text, so rich text is instead filtered
 * against a tag/attribute allowlist.
 */
export function sanitizeOutput(value: string, richText: boolean = false): string {
  if (richText) {
    return sanitizeRichText(value)
  }
  return htmlEscape(value)
}
