import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown.js'

describe('markdown component', () => {
  it('wraps the document in the class the theme styles', () => {
    expect(renderMarkdown('Hello.')).toBe('<div class="sure-markdown"><p>Hello.</p></div>')
  })

  it('renders headings below the page title', () => {
    // A document sits under the page's own <h1>, so "#" starts at h2 by default.
    expect(renderMarkdown('# One\n\n## Two')).toBe(
      '<div class="sure-markdown"><h2>One</h2>\n<h3>Two</h3></div>',
    )
    expect(renderMarkdown('# One', { baseHeading: 1 })).toContain('<h1>One</h1>')
  })

  it('renders paragraphs, joining wrapped lines', () => {
    expect(renderMarkdown('One line\nand its continuation.\n\nSecond.')).toBe(
      '<div class="sure-markdown"><p>One line and its continuation.</p>\n<p>Second.</p></div>',
    )
  })

  it('keeps a hard break, so an address block keeps its shape', () => {
    const html = renderMarkdown('Example LLC  \n1 Main Street  \nMetairie, LA')
    expect(html).toBe('<div class="sure-markdown"><p>Example LLC<br>1 Main Street<br>Metairie, LA</p></div>')
  })

  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- a\n- b')).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('1. first\n2. second')).toContain('<ol><li>first</li><li>second</li></ol>')
  })

  it('renders a table with a header row', () => {
    const html = renderMarkdown('| Charge | Limit |\n|---|---|\n| Cancellation | $25 |')
    expect(html).toContain('<table><thead><tr><th>Charge</th><th>Limit</th></tr></thead>')
    expect(html).toContain('<tbody><tr><td>Cancellation</td><td>$25</td></tr></tbody>')
  })

  it('renders quotes and rules', () => {
    expect(renderMarkdown('> quoted')).toContain('<blockquote><p>quoted</p></blockquote>')
    expect(renderMarkdown('---')).toContain('<hr>')
  })

  it('renders inline code, bold and italic', () => {
    const html = renderMarkdown('Use `computeContract` and **never** *guess*.')
    expect(html).toContain('<code>computeContract</code>')
    expect(html).toContain('<strong>never</strong>')
    expect(html).toContain('<em>guess</em>')
  })

  it('does not let emphasis reach inside a code span', () => {
    const html = renderMarkdown('`a **b** c`')
    expect(html).toContain('<code>a **b** c</code>')
    expect(html).not.toContain('<strong>')
  })

  it('shows raw HTML instead of executing it', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('builds links through the protocol allowlist', () => {
    const html = renderMarkdown('[OFI](https://ofi.la.gov/) and [terms](/terms.html)')
    expect(html).toContain('<a href="https://ofi.la.gov/" rel="noopener noreferrer">OFI</a>')
    expect(html).toContain('<a href="/terms.html">terms</a>')
    expect(() => renderMarkdown('[x](javascript:alert(1))')).toThrow(/not http\(s\)/)
  })

  it('escapes a link label that tries to smuggle markup', () => {
    const html = renderMarkdown('[<img src=x>](/terms.html)')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x&gt;')
  })

  it('keeps an escaped angle bracket from opening a tag around emphasis', () => {
    const html = renderMarkdown('a < b **and** c')
    expect(html).toBe('<div class="sure-markdown"><p>a &lt; b <strong>and</strong> c</p></div>')
  })
})
