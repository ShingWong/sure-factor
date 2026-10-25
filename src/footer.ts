// Footer markup, generated as a string.
//
// A menu is runtime chrome, so `renderMenu` builds DOM. A footer is static
// content that belongs in the HTML a server or build writes — a legal page must
// render with scripts disabled. Text output also makes the whole risk surface
// escaping, which is why every value here goes through `escapeHtml` and every
// URL through `safeHref`.

/** The catalog's class contract for `page-footer`. Keep in step with the yaml. */
export const FOOTER_CLASSES = {
  root: 'sure-footer',
  inner: 'sure-footer__inner',
  legal: 'sure-footer__legal',
  links: 'sure-footer__links',
  link: 'sure-footer__link',
  credit: 'sure-footer__credit',
} as const

export interface FooterLink {
  /** Visible text. Escaped. */
  label: string
  /** Destination. Validated: http(s), mailto, or a site-relative path. */
  href: string
}

export interface FooterCredit {
  /** Text that introduces the link, e.g. "Powered by". Escaped. */
  text: string
  /** Optional destination; without it the credit is plain text. */
  href?: string
}

export interface FooterOptions {
  /** The copyright line: "@company, all rights reserved" or similar. */
  legal: string
  /** Legal/navigation destinations, in display order. */
  links?: readonly FooterLink[]
  /** Build credit, e.g. { text: "Powered by sure-stack", href: "https://…" }. */
  credit?: FooterCredit
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escape text for an HTML body or a double-quoted attribute.
 *
 * Every consumer of this module passes *data* — a company name, a link label —
 * and a label containing `<script>` must be shown, not executed.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Accept only destinations a footer should point at.
 *
 * `javascript:` in an href is the classic injection, and it survives escaping —
 * so the protocol is checked, not sanitised. A relative path (no scheme) is
 * fine; a protocol-relative `//host` is not, because it silently leaves the
 * site over whatever protocol the page happens to use.
 */
export function safeHref(href: string): string {
  const value = href.trim()
  if (value === '') throw new Error('footer link: empty href')
  if (value.startsWith('//')) throw new Error(`footer link: protocol-relative href "${href}"`)
  const scheme = SCHEME.exec(value)
  if (scheme) {
    const protocol = scheme[0].toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:') {
      throw new Error(`footer link: "${href}" is not http(s), mailto, or a relative path`)
    }
  }
  return value
}

const isExternal = (href: string): boolean => /^(https?:)?\/\//i.test(href)

/**
 * Render a footer.
 *
 * The markup matches sure-ui's `footer` block: `inner` holds the legal line,
 * the link list and the credit in one row that wraps on a phone, and the block
 * hides itself when printing.
 */
export function renderFooter(options: FooterOptions): string {
  const classes = FOOTER_CLASSES
  const parts: string[] = []

  parts.push(`<p class="${classes.legal}">${escapeHtml(options.legal)}</p>`)

  const links = options.links ?? []
  if (links.length > 0) {
    const items = links.map((link) => {
      const href = safeHref(link.href)
      // External destinations get rel: the page is a financial portal and must
      // not hand the target a `window.opener` handle.
      const rel = isExternal(href) ? ' rel="noopener noreferrer"' : ''
      return `<li><a class="${classes.link}" href="${escapeHtml(href)}"${rel}>${escapeHtml(link.label)}</a></li>`
    })
    parts.push(`<ul class="${classes.links}">${items.join('')}</ul>`)
  }

  if (options.credit) {
    const { text, href } = options.credit
    const label = escapeHtml(text)
    const credit = href
      ? `<a href="${escapeHtml(safeHref(href))}"${isExternal(href) ? ' rel="noopener noreferrer"' : ''}>${label}</a>`
      : label
    parts.push(`<p class="${classes.credit}">${credit}</p>`)
  }

  return `<footer class="${classes.root}"><div class="${classes.inner}">${parts.join('')}</div></footer>`
}

export default renderFooter
