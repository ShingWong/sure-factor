import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'playwright'
import { introspectSchemaFromDdl } from '../introspect.js'
import { loadAllTypesSync, matchColumnToTypeSync } from '../match.js'
import { generateForTier } from '../generate.js'
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const ddl = `
  CREATE TABLE patients (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    diagnosis VARCHAR(8),
    zip VARCHAR(5),
    is_active BOOLEAN NOT NULL DEFAULT true
  );
`

describe('E2E: generated form renders correctly', () => {
  let htmlPath: string
  let browser: Browser

  beforeAll(async () => {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true })

    const schema = introspectSchemaFromDdl(ddl)
    const allTypes = loadAllTypesSync()
    const table = schema.tables[0]!

    const gen = generateForTier(schema, { tier: 'production', component: 'form', locale: 'en' })
    const i18nData = gen.i18n

    // The form carries class="sure-form" exactly as generateTemplate emits it
    // (formClass = cssClasses.form ?? 'sure-form'): compose styles the input
    // through the `.sure-form input` descendant rule, and dropping the
    // ancestor silently falls back to the generic 4px rule — the fixture must
    // mirror what the generator ships, or it tests a page nobody generates.
    const fields = table.columns
      .filter(c => c.columnName !== 'id')
      .map(col => {
        const matched = matchColumnToTypeSync(col, allTypes, 'production')
        const type = matched?.type
        const label = type ? (i18nData[`types.${type.name}.label`] ?? col.columnName) : col.columnName
        const help = type ? (i18nData[`types.${type.name}.help`] ?? '') : ''
        return `
  <div class="sure-form__field">
    <label class="sure-form__label" for="${col.columnName}">${label}</label>
    <input type="text" id="${col.columnName}" name="${col.columnName}" class="sure-form__input" />
    <span class="sure-form__help">${help}</span>
  </div>`
      }).join('\n')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Patient Form — E2E</title>
<style>${gen.styles}</style>
</head>
<body style="padding:2rem;font-family:sans-serif">
<h1>Patient Registration</h1>
<form class="sure-form" hx-post="/api/patients" hx-target="this" hx-swap="outerHTML" novalidate>
${fields}
<button type="submit" class="btn-primary">Submit</button>
</form>
</body>
</html>`

    const tmpDir = mkdtempSync(join(tmpdir(), 'sure-e2e-'))
    htmlPath = join(tmpDir, 'form.html')
    writeFileSync(htmlPath, html)
  }, 30000)

  afterAll(async () => {
    if (browser) await browser.close()
  })

  const getPage = async (): Promise<Page> => {
    const page = await browser.newPage()
    await page.goto(`file://${htmlPath}`)
    await page.waitForLoadState('domcontentloaded')
    return page
  }

  it('renders page title', { timeout: 15000 }, async () => {
    const page = await getPage()
    try {
      expect(await page.textContent('h1')).toBe('Patient Registration')
      expect(await page.getAttribute('form', 'hx-post')).toBe('/api/patients')
    } finally {
      await page.close()
    }
  })

  it('renders all input fields from DDL', { timeout: 15000 }, async () => {
    const page = await getPage()
    try {
      for (const name of ['email', 'full_name', 'diagnosis', 'zip', 'is_active']) {
        expect(await page.$(`input[name="${name}"]`)).not.toBeNull()
      }
      expect(await page.textContent('.btn-primary')).toBe('Submit')
    } finally {
      await page.close()
    }
  })

  it('supports interactive field input', { timeout: 15000 }, async () => {
    const page = await getPage()
    try {
      await page.fill('input[name="email"]', 'test@example.com')
      expect(await page.inputValue('input[name="email"]')).toBe('test@example.com')
      await page.fill('input[name="zip"]', '90210')
      expect(await page.inputValue('input[name="zip"]')).toBe('90210')
    } finally {
      await page.close()
    }
  })

  it('composed styles actually style the page in a real browser', { timeout: 15000 }, async () => {
    // The whole point of shipping compose() output: the theme's tokens must
    // resolve and the block rules must beat browser defaults. Nord's
    // --field token is #fff and its input rule rounds to 6px — the UA
    // default is a 2px grey bevel, so both assertions can only pass if the
    // generated stylesheet loaded and applied.
    const page = await getPage()
    try {
      const probe = await page.evaluate(() => {
        const input = document.querySelector('input[name="email"]') as HTMLInputElement
        const btn = document.querySelector('.btn-primary') as HTMLElement
        const cs = getComputedStyle(input)
        return {
          field: cs.backgroundColor,
          radius: cs.borderRadius,
          btnBg: getComputedStyle(btn).backgroundColor,
          layer: [...document.styleSheets].some((s) => {
            try { return (s.cssRules[0]?.cssText ?? '').startsWith('@layer sure.tokens,') } catch { return false }
          }),
        }
      })
      expect(probe.layer, 'layer statement must be the first rule').toBe(true)
      expect(probe.field, 'input must use the theme --field token').toBe('rgb(255, 255, 255)')
      expect(probe.radius, 'compose input rule must round to 6px').toBe('6px')
      expect(probe.btnBg, 'btn-primary must take the theme primary').toBe('rgb(129, 161, 193)')
    } finally {
      await page.close()
    }
  })
})
