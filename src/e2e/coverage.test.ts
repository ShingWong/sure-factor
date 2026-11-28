import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser } from 'playwright'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Phase D browser evidence: every built-in catalog component has a generated
 * standalone demo (scripts/build-coverage-demos.mjs). This test loads each one
 * in Chromium and checks both real DOM structure and an accessibility invariant
 * appropriate to the renderer kind. It does not mock the generated module.
 */
const demosDir = new URL('../../e2e/demos/', import.meta.url)
const demoNames = readdirSync(demosDir)
  .filter((name) => name.endsWith('.html') && name !== 'index.html')
  .map((name) => name.replace(/\.html$/, ''))
  .sort()

describe('component browser coverage', () => {
  let browser: Browser

  beforeAll(async () => {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    if (browser) await browser.close()
  })

  it('discovers a demo for every catalog entry', () => {
    const yamlNames = readdirSync(new URL('../../catalog/components/', import.meta.url))
      .filter((name) => name.endsWith('.yaml'))
      .map((name) => name.replace(/\.yaml$/, ''))
      .sort()
    expect(demoNames).toEqual(yamlNames)
  })

  for (const name of demoNames) {
    it(`${name} renders with accessible structure`, { timeout: 20000 }, async () => {
      const htmlPath = join(demosDir.pathname, `${name}.html`)
      const js = readFileSync(join(demosDir.pathname, `${name}.js`), 'utf8')
      const kind = js.includes('function renderForm(') ? 'form'
        : js.includes('function renderTable(') ? 'table'
          : 'menu'
      const page = await browser.newPage()
      try {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto(pathToFileURL(htmlPath).href)
        await page.waitForSelector('#app > *')
        expect(errors, `${name} threw in the browser`).toEqual([])

        // Browser structure: the real generated renderer mounted a root.
        const rootTag = await page.locator('#app > *').first().evaluate((el) => el.tagName.toLowerCase())
        const expectedRoot = kind === 'table' ? 'table' : kind === 'form' ? 'form' : 'nav'
        expect(rootTag, `${name} mounted ${rootTag}, expected ${expectedRoot}`).toBe(expectedRoot)

        // Accessibility invariant matching the renderer's contract.
        if (kind === 'form') {
          expect(await page.locator('label[for]').count(), `${name} has no associated labels`).toBeGreaterThan(0)
          expect(await page.locator('input').first().getAttribute('type')).toBe('email')
        } else if (kind === 'table') {
          expect(await page.locator('th').count(), `${name} has no column headers`).toBeGreaterThan(0)
        } else {
          expect(await page.locator('button').count(), `${name} has no actionable items`).toBeGreaterThan(0)
          const accessibleNames = await page.locator('button').evaluateAll((buttons) =>
            buttons.map((button) => (button.getAttribute('aria-label') || button.textContent || '').trim()))
          expect(accessibleNames.every((label) => label.length > 0), `${name} has an unnamed button`).toBe(true)
        }
      } finally {
        await page.close()
      }
    })
  }
})
