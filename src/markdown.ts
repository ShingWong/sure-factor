// Markdown → HTML for the `markdown` component the catalog already declares.
//
// Why this exists: `catalog/components/markdown.yaml` describes themed prose
// (`sure-markdown`, tables, quotes, code), but `generateClientComponent` answers
// `null` for it and `generateForTier` only wraps a template — so the component
// was unusable. Legal pages, help text and release notes are exactly the prose
// it was meant for, and they must render without JavaScript.
//
// The subset is deliberate: headings, paragraphs, lists, tables, quotes, rules,
// and inline code/bold/italic/links. Every value is HTML-escaped *first*, so
// raw HTML in a document is shown rather than executed — an author cannot
// inject markup through content, and escaping happens before any emphasis is
// applied so a `<` inside a paragraph cannot open a tag.

/** Escape text for an HTML body or double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** http(s), mailto, or a site-relative destination; anything else throws. */
export function safeHref(href: string): string {
  const value = href.trim()
  if (value === '') throw new Error('markdown link: empty href')
  if (value.startsWith('//')) throw new Error(`markdown link: protocol-relative href "${href}"`)
  const scheme = SCHEME.exec(value)
  if (scheme) {
    const protocol = scheme[0].toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:') {
      throw new Error(`markdown link: "${href}" is not http(s), mailto, or a relative path`)
    }
  }
  return value
}

const isExternal = (href: string): boolean => /^(https?:)?\/\//i.test(href)

/**
 * Inline markup for one run of text.
 *
 * Code spans are lifted out first, because `` `a ** b` `` must not become bold;
 * links are built (label escaped, destination validated) and stashed for the
 * same reason — escaping a half-built `<a>` would mangle the attribute.
 */
function inline(text: string): string {
  const stash: string[] = []
  const hold = (html: string): string => `\u0000${stash.push(html) - 1}\u0000`

  let work = text.replace(/`([^`]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`))

  work = work.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const target = safeHref(href)
    const rel = isExternal(target) ? ' rel="noopener noreferrer"' : ''
    return hold(`<a href="${escapeHtml(target)}"${rel}>${emphasis(escapeHtml(label))}</a>`)
  })

  return emphasis(escapeHtml(work)).replace(/\u0000(\d+)\u0000/g, (_, index: string) => stash[Number(index)]!)
}

const emphasis = (escaped: string): string =>
  escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')

interface Options {
  /** Heading level for `#`. Defaults to 2: a document usually sits under the page's own `<h1>`. */
  baseHeading?: number
}

/** Render a Markdown document as the markup `sure-markdown` styles. */
export function renderMarkdown(source: string, options: Options = {}): string {
  const base = options.baseHeading ?? 2
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  let i = 0

  const flush = (): void => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const headingLevel = (level: number): number => Math.min(6, Math.max(1, level + base - 1))

  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (trimmed === '') {
      flush()
      i += 1
      continue
    }

    // Rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush()
      out.push('<hr>')
      i += 1
      continue
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flush()
      const level = headingLevel(heading[1]!.length)
      out.push(`<h${level}>${inline(heading[2]!.trim())}</h${level}>`)
      i += 1
      continue
    }

    // Table: a header row followed by a separator row of dashes and colons.
    const next = lines[i + 1]?.trim() ?? ''
    if (trimmed.includes('|') && /^\|?[\s:-]*-[\s:|-]*\|?$/.test(next) && next.includes('-')) {
      flush()
      const cells = (row: string): string[] =>
        row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim())
      const head = cells(trimmed)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim().includes('|')) {
        rows.push(cells(lines[i]!.trim()))
        i += 1
      }
      const headHtml = head.map((cell) => `<th>${inline(cell)}</th>`).join('')
      const bodyHtml = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`)
      continue
    }

    // Blockquote: consecutive "> " lines become one quote of paragraphs.
    if (/^>\s?/.test(trimmed)) {
      flush()
      const quoted: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!.trim())) {
        quoted.push(lines[i]!.trim().replace(/^>\s?/, ''))
        i += 1
      }
      const body = quoted
        .join('\n')
        .split(/\n{2,}/)
        .map((block) => `<p>${inline(block.replace(/\n/g, ' '))}</p>`)
        .join('')
      out.push(`<blockquote>${body}</blockquote>`)
      continue
    }

    // Lists. A blank line or a non-item line ends the list; nested lists are
    // out of scope on purpose (indentation rules differ per dialect).
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (bullet || ordered) {
      flush()
      const orderedList = Boolean(ordered)
      const items: string[] = []
      while (i < lines.length) {
        const row = lines[i]!.trim()
        const match = orderedList ? /^\d+[.)]\s+(.*)$/.exec(row) : /^[-*]\s+(.*)$/.exec(row)
        if (!match) break
        items.push(`<li>${inline(match[1]!.trim())}</li>`)
        i += 1
      }
      const tag = orderedList ? 'ol' : 'ul'
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    paragraph.push(trimmed)
    i += 1
  }

  flush()
  return `<div class="sure-markdown">${out.join('\n')}</div>`
}

export default renderMarkdown
