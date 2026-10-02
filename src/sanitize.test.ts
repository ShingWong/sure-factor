import { describe, it, expect, vi } from 'vitest'
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
} from './sanitize.js'

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

  // The catalog writes parameterised steps in YAML as mappings, which parse to
  // objects and are flattened to `name: arg`. Both generators emit that form,
  // so it is the spelling that actually reaches sanitize() at runtime — and it
  // used to be ignored, silently. Every catalog recipe containing a
  // parameterised step (`normalize: NFKC` in date-iso, date-us, ein, email)
  // shipped unsanitised because of it.
  it('accepts the catalog spelling `name: arg`', () => {
    expect(sanitize('\uFF34est', ['normalize: NFKC', 'lowercase'])).toBe('test')
  })

  it('treats the two spellings of a parameterised step identically', () => {
    // Full-width digits, the case NFKC exists to fold.
    const wide = '\uFF12\uFF10\uFF12\uFF16-\uFF10\uFF11-\uFF10\uFF12'
    for (const steps of [['normalize: NFKC'], ['normalize(NFKC)']]) {
      expect(sanitize(wide, steps), steps[0]).toBe('2026-01-02')
    }
  })

  it('handles slice with parameter', () => {
    const result = sanitize('hello world', ['trim', 'slice(0,5)'])
    expect(result).toBe('hello')
  })

  it('accepts slice written as a catalog mapping with several arguments', () => {
    // `- slice(0, 10)` stays a string in YAML; a mapping form may carry more
    // than one argument, and must not be split on the comma.
    expect(sanitize('hello world', ['slice: 0, 5'])).toBe('hello')
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

describe('sanitizeOutput rich text is not a bypass', () => {
  it('drops script tags and their contents stay inert', () => {
    const out = sanitizeOutput('<script>alert(1)</script>', true)
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert(1)')
  })

  it('drops event-handler attributes', () => {
    expect(sanitizeOutput('<b onclick="alert(1)">x</b>', true)).toBe('<b>x</b>')
    expect(sanitizeOutput('<img src=x onerror=alert(1)>', true)).not.toContain('onerror')
  })

  it('drops img/iframe/object entirely', () => {
    expect(sanitizeOutput('<img src=x onerror=alert(1)>', true)).toBe('')
    expect(sanitizeOutput('<iframe src="evil"></iframe>', true)).toBe('')
    expect(sanitizeOutput('<object data="x"></object>', true)).toBe('')
  })

  it('rejects javascript: and data: URLs on links', () => {
    expect(sanitizeOutput('<a href="javascript:alert(1)">x</a>', true)).not.toContain('javascript:')
    expect(sanitizeOutput('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', true)).not.toContain('data:')
  })

  it('keeps safe formatting and link markup', () => {
    expect(sanitizeOutput('<p>hi <strong>there</strong></p>', true)).toBe('<p>hi <strong>there</strong></p>')
    expect(sanitizeOutput('<a href="https://example.com">x</a>', true)).toBe('<a href="https://example.com">x</a>')
  })

  it('keeps inner text of a disallowed element but not the element', () => {
    expect(sanitizeOutput('<marquee>hello</marquee>', true)).toBe('hello')
  })

  it('escapes stray angle brackets so they cannot start a tag', () => {
    expect(sanitizeOutput('5 < 6 and a<b', true)).not.toMatch(/<(?!br|b|i|p|ul|ol|li)[\s\S]/i)
  })

  it('strips comments', () => {
    expect(sanitizeOutput('a<!-- <script>alert(1)</script> -->b', true)).not.toContain('script')
  })

  it('escapes a double-encoded payload only once, never into live markup', () => {
    const out = sanitizeOutput('&lt;script&gt;alert(1)&lt;/script&gt;', true)
    expect(out).not.toContain('<script>')
  })
})

describe('anti-spoofing completeness', () => {
  it('strips the full bidi override and embedding set', () => {
    // Embeddings, overrides, isolates, the legacy explicit-formatting range and
    // the directional marks must all go; each can visually reorder text.
    const controls = [
      '‪', '‫', '‬', '‭', '‮',
      '⁦', '⁧', '⁨', '⁩',
      '‎', '‏',
      '؜',
      '⁪', '⁫', '⁬', '⁭', '⁮', '⁯',
    ]
    for (const c of controls) {
      expect(stripDirectionOverrides(`a${c}b`), `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).toBe('ab')
    }
  })

  it('strips the C1 control range', () => {
    expect(stripControl('abc')).toBe('abc')
  })

  it('preserves tab, newline and carriage return', () => {
    expect(stripControl('a\nb\tc\rd')).toBe('a\nb\tc\rd')
  })

  it('removes an injected bidi mark from a name via sanitizeInput', () => {
    expect(sanitizeInput('ad‮min\u202E')).toBe('admin')
  })
})

describe('slice bounds', () => {
  it('leaves the value intact when the start bound is not a finite number', () => {
    // 'hello'.slice(0, NaN) is '' — silently wiping the value.
    expect(sanitize('hello', ['slice(abc)'])).toBe('hello')
    expect(sanitize('hello', ['slice()'])).toBe('hello')
  })

  it('leaves the value intact when the end bound is not a finite number', () => {
    expect(sanitize('hello world', ['slice(0,xyz)'])).toBe('hello world')
  })

  it('never splits an astral character in half', () => {
    // Truncating '😀' at 1 code unit would leave a lone high surrogate.
    const out = sanitize('😀ok', ['slice(0,1)'])
    expect(out).toBe('')
    expect([...out].every(ch => ch.codePointAt(0)! >= 0xd800 || ch.length === 1)).toBe(true)
    expect(out.includes('\uD83D')).toBe(false)
  })

  it('keeps a whole surrogate pair when it fits', () => {
    expect(sanitize('😀ok', ['slice(0,2)'])).toBe('😀')
  })

  it('truncates a multi-byte name without breaking it', () => {
    expect(sanitizeInput('😀'.repeat(3), 2)).toBe('😀')
  })
})

describe('normalize form validation', () => {
  it('accepts the four real Unicode forms', () => {
    // U+00C5 (composed) vs U+0041 U+030A (decomposed) look identical but
    // differ in code points, so compare explicitly.
    const composed = '\u00C5'
    const decomposed = '\u0041\u030A'
    expect(normalize(decomposed, 'NFC')).toBe(composed)
    expect(normalize(composed, 'NFD')).toBe(decomposed)
    expect([...normalize(decomposed, 'NFC')].map(c => c.codePointAt(0)!.toString(16))).toEqual(['c5'])
    expect([...normalize(composed, 'NFD')].map(c => c.codePointAt(0)!.toString(16))).toEqual(['41', '30a'])
  })

  it('falls back to NFKC for an unknown form instead of throwing RangeError', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => normalize('abc', 'NFKC1')).not.toThrow()
    expect(normalize('abc', 'NFKC1')).toBe(normalize('abc', 'NFKC'))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not throw for an unknown form reached through the pipeline', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => sanitize('abc', ['normalize(NFKC1)'])).not.toThrow()
    warn.mockRestore()
  })
})
