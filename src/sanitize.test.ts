import { describe, it, expect } from 'vitest'
import {
  sanitize,
  sanitizeInput,
  sanitizeOutput,
  normalize,
  stripDirectionOverrides,
  stripZeroWidth,
  stripControl,
  trim,
  uppercase,
  lowercase,
  stripNonDigits,
  collapseWhitespace,
  htmlEscape,
  slice,
} from './sanitize'

describe('individual sanitize steps', () => {
  it('normalize NFKC decomposes homoglyphs', () => {
    const homoglyph = '\uFF34' // FULLWIDTH LATIN CAPITAL LETTER T
    expect(normalize(homoglyph, 'NFKC')).toBe('T')
  })

  it('stripDirectionOverrides removes U+202E', () => {
    const input = 'abc\u202ECBA'
    expect(stripDirectionOverrides(input)).toBe('abcCBA')
  })

  it('stripDirectionOverrides removes U+2066-2069', () => {
    const input = '\u2066hello\u2069'
    expect(stripDirectionOverrides(input)).toBe('hello')
  })

  it('stripZeroWidth removes zero-width chars', () => {
    const input = 'a\u200Bb\u200Cc\u200Dd\uFEFFe'
    expect(stripZeroWidth(input)).toBe('abcde')
  })

  it('stripControl removes control characters', () => {
    const input = 'a\x00b\x01c\x7Fd'
    expect(stripControl(input)).toBe('abcd')
  })

  it('stripControl preserves regular whitespace', () => {
    expect(stripControl('hello world')).toBe('hello world')
  })

  it('trim removes surrounding whitespace', () => {
    expect(trim('  hello  ')).toBe('hello')
  })

  it('uppercase converts to uppercase', () => {
    expect(uppercase('hello')).toBe('HELLO')
  })

  it('lowercase converts to lowercase', () => {
    expect(lowercase('HELLO')).toBe('hello')
  })

  it('stripNonDigits removes non-digit characters', () => {
    expect(stripNonDigits('(555) 123-4567')).toBe('5551234567')
  })

  it('collapseWhitespace replaces multiple spaces with one', () => {
    expect(collapseWhitespace('hello    world')).toBe('hello world')
  })

  it('collapseWhitespace trims edges', () => {
    expect(collapseWhitespace('  hello   world  ')).toBe('hello world')
  })

  it('htmlEscape escapes HTML special chars', () => {
    expect(htmlEscape('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;')
  })

  it('htmlEscape preserves safe text', () => {
    expect(htmlEscape('hello world')).toBe('hello world')
  })

  it('slice truncates string', () => {
    expect(slice('hello world', 0, 5)).toBe('hello')
  })
})

describe('sanitize pipeline', () => {
  it('applies multiple steps in order', () => {
    const result = sanitize('  <SCRIPT>alert("xss")</SCRIPT>  ', ['trim', 'lowercase', 'htmlEscape'])
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;')
  })

  it('handles normalize with parameter', () => {
    const result = sanitize('\uFF34est', ['normalize(NFKC)', 'lowercase'])
    expect(result).toBe('test')
  })

  it('handles slice with parameter', () => {
    const result = sanitize('hello world', ['trim', 'slice(0,5)'])
    expect(result).toBe('hello')
  })

  it('skips unknown steps', () => {
    const result = sanitize('  hello  ', ['trim', 'unknownStep'])
    expect(result).toBe('hello')
  })

  it('processes an empty steps array', () => {
    const result = sanitize('hello', [])
    expect(result).toBe('hello')
  })

  it('processes email-type sanitization', () => {
    const result = sanitize('  User@Example.COM  ', ['trim', 'lowercase', 'normalize(NFKC)'])
    expect(result).toBe('user@example.com')
  })

  it('processes zip5-type sanitization', () => {
    const result = sanitize('  90210-1234  ', ['trim', 'stripNonDigits', 'normalize(NFKC)', 'slice(0,5)'])
    expect(result).toBe('90210')
  })

  it('processes phone-type sanitization', () => {
    const result = sanitize('  (555) 123-4567  ', ['stripNonDigits', 'normalize(NFKC)'])
    expect(result).toBe('5551234567')
  })

  it('processes full-name sanitization', () => {
    const result = sanitize('  Jane   Doe  ', ['trim', 'collapseWhitespace', 'normalize(NFKC)'])
    expect(result).toBe('Jane Doe')
  })
})

describe('sanitizeInput full pipeline', () => {
  it('applies full 8-step input pipeline', () => {
    const malicious = '\uFF34\u0065\u0073\u0074\x00\x01  <b>bold</b>  '
    const result = sanitizeInput(malicious)
    expect(result).not.toContain('\x00')
    expect(result).not.toContain('\x01')
    expect(result).not.toContain('\uFF34')
    expect(result).toContain('<b>bold</b>')
    expect(result.startsWith('Test')).toBe(true)
  })

  it('truncates by maxLength', () => {
    const result = sanitizeInput('hello world', 5)
    expect(result).toBe('hello')
  })

  it('does not truncate when maxLength is null', () => {
    const result = sanitizeInput('hello world', null)
    expect(result).toBe('hello world')
  })
})

describe('sanitizeOutput', () => {
  it('escapes HTML by default', () => {
    expect(sanitizeOutput('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;')
  })

  it('passes through for rich text', () => {
    expect(sanitizeOutput('<b>bold</b>', true)).toBe('<b>bold</b>')
  })
})
