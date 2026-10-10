/**
 * The registry drift guard (design doc, sure-factor integration).
 *
 * catalog yamls declare `sure_ui: [blocks]` — the sure-ui families whose
 * styles their generated markup needs. Two drifts are possible and both are
 * caught here:
 *
 *   1. yaml → sure-ui: a declared block that sure-ui no longer exports (a
 *      family renamed or dropped upstream) fails against the live COMPONENTS
 *      export, not a hand-copied list.
 *   2. cssClasses → sure_ui: a yaml that starts using a family's classes
 *      (`sure-dialog__title`) without declaring the block (`dialog`) gets
 *      styled markup nobody ships styles for — the exact class of silent
 *      breakage the old vendored themes hid.
 *
 * The template's own hardcoded classes are guarded too: every generated
 * template submits with `btn-primary`, and falls back to a `sure-form`
 * wrapper when the yaml declares no `form` class — so `buttons` is always
 * required, and `form` is required whenever cssClasses omits it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { COMPONENTS } from '@shing.wong/sure-ui'
import { parseYaml } from './parse-yaml.js'
import type { CatalogComponent } from './types.js'

const DIR = new URL('../catalog/components/', import.meta.url)
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.yaml'))

/** cssClasses value → the sure-ui family whose block must style it, or null
    for catalog-private classes (`preview-panel*`, bare modifiers like
    `active`) that no sure-ui family owns. */
function familyOf(cssClass: string): string | null {
  const first = cssClass.split(/\s+/)[0]! // 'sure-markdown code' → 'sure-markdown'
  let fam: string
  if (first.startsWith('sure-')) fam = first.slice(5).split(/[-_]/)[0]!
  else if (first.startsWith('btn-')) fam = 'buttons'
  else if (first.startsWith('msg-')) fam = 'sessions' // msg-* lives in the sessions block
  else return null
  return fam === 'session' ? 'sessions' : fam // yaml says session-list; family is sessions
}

function loadComponents(): CatalogComponent[] {
  return FILES.map((f) => parseYaml(readFileSync(new URL(f, DIR), 'utf-8')) as unknown as CatalogComponent)
}

describe('catalog registry: sure_ui declares what the markup needs', () => {
  const components = loadComponents()

  it('every yaml is present and declares sure_ui', () => {
    expect(components.length).toBeGreaterThan(10)
    const missing = components.filter((c) => !Array.isArray(c.sure_ui) || c.sure_ui.length === 0).map((c) => c.name)
    expect(missing, `yamls missing sure_ui: ${missing.join(', ')}`).toEqual([])
  })

  it('every declared block is a family sure-ui actually exports', () => {
    const known = new Set<string>(COMPONENTS)
    const bad: string[] = []
    for (const c of components) for (const b of c.sure_ui ?? []) if (!known.has(b)) bad.push(`${c.name}: ${b}`)
    expect(bad, `blocks not in sure-ui COMPONENTS: ${bad.join(', ')}`).toEqual([])
  })

  it('every sure-ui family used by cssClasses is declared in sure_ui', () => {
    const drift: string[] = []
    for (const c of components) {
      const blocks = new Set(c.sure_ui ?? [])
      for (const value of Object.values(c.cssClasses ?? {})) {
        const fam = familyOf(value)
        if (fam && !blocks.has(fam)) drift.push(`${c.name}: cssClasses uses "${value}" → ${fam} not in sure_ui`)
      }
    }
    expect(drift, drift.join('\n')).toEqual([])
  })

  it("the template's hardcoded submit button is covered everywhere", () => {
    // generateTemplate always emits class="btn-primary"; a yaml that forgets
    // `buttons` renders an unstyled submit.
    const missing = components.filter((c) => !(c.sure_ui ?? []).includes('buttons')).map((c) => c.name)
    expect(missing, `yamls whose submit button would be unstyled: ${missing.join(', ')}`).toEqual([])
  })

  it('the template\'s sure-form fallback wrapper is covered when cssClasses omits form', () => {
    // generateTemplate emits <form class="…sure-form"> when cssClasses has no
    // `form` key — that yaml must ship the form block to style its wrapper.
    const missing = components
      .filter((c) => !(c.cssClasses?.form) && !(c.sure_ui ?? []).includes('form'))
      .map((c) => c.name)
    expect(missing, `yamls whose form wrapper would be unstyled: ${missing.join(', ')}`).toEqual([])
  })
})
