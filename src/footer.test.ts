import { describe, it, expect } from 'vitest'
import { renderFooter, escapeHtml, safeHref } from './footer.js'

describe('page footer', () => {
  const legal = '© 2026 FCS LLC. All rights reserved.'

  it('renders the catalog classes and one wrapping row', () => {
    const html = renderFooter({
      legal,
      links: [
        { label: 'Privacy', href: '/privacy.html' },
        { label: 'Terms', href: '/terms.html' },
      ],
      credit: { text: 'Powered by sure-stack', href: 'https://positronic-ai.us/sure/' },
    })

    expect(html.startsWith('<footer class="sure-footer">')).toBe(true)
    expect(html).toContain('<div class="sure-footer__inner">')
    expect(html).toContain('<p class="sure-footer__legal">© 2026 FCS LLC. All rights reserved.</p>')
    expect(html).toContain('<ul class="sure-footer__links">')
    expect(html).toContain('<a class="sure-footer__link" href="/privacy.html">Privacy</a>')
    expect(html).toContain('<p class="sure-footer__credit">')
    // Every part inside the single outer element: two roots would break the
    // landmark and the flex row.
    expect(html.match(/<footer/g)).toHaveLength(1)
    expect(html.endsWith('</footer>')).toBe(true)
  })

  it('escapes text, so a company name cannot become markup', () => {
    const html = renderFooter({ legal: '<script>alert(1)</script> & "Co"' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('escapes link labels', () => {
    const html = renderFooter({ legal, links: [{ label: '<b>Terms</b>', href: '/terms.html' }] })
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;Terms&lt;/b&gt;')
  })

  it('marks external destinations rel=noopener noreferrer and leaves internal ones alone', () => {
    const html = renderFooter({
      legal,
      links: [
        { label: 'Privacy', href: '/privacy.html' },
        { label: 'OFI', href: 'https://ofi.la.gov/' },
      ],
    })
    expect(html).toContain('href="/privacy.html"')
    expect(html).toContain('href="https://ofi.la.gov/" rel="noopener noreferrer"')
  })

  it('refuses a javascript: destination instead of sanitising it into place', () => {
    expect(() => renderFooter({ legal, links: [{ label: 'x', href: 'javascript:alert(1)' }] })).toThrow(/not http\(s\)/)
    expect(() => renderFooter({ legal, links: [{ label: 'x', href: 'data:text/html,hi' }] })).toThrow(/not http\(s\)/)
    expect(() => renderFooter({ legal, links: [{ label: 'x', href: '//evil.example' }] })).toThrow(/protocol-relative/)
  })

  it('omits the list when there are no links, and the credit without a destination', () => {
    const bare = renderFooter({ legal })
    expect(bare).not.toContain('sure-footer__links')
    expect(bare).not.toContain('sure-footer__credit')

    const noHref = renderFooter({ legal, credit: { text: 'Powered by sure-stack' } })
    expect(noHref).toContain('<p class="sure-footer__credit">Powered by sure-stack</p>')
    expect(noHref).not.toContain('<a ')
  })

  it('accepts mailto and relative destinations', () => {
    expect(safeHref('mailto:office@example.com')).toBe('mailto:office@example.com')
    expect(safeHref('privacy.html')).toBe('privacy.html')
    expect(safeHref('#top')).toBe('#top')
  })

  it('escapeHtml covers the attribute-breaking characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
