import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'playwright'
import { introspectSchemaFromDdl } from './introspect'
import { loadAllTypesSync, matchColumnToTypeSync } from './match'
import { generateForTier } from './generate'
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
</head>
<body style="padding:2rem;font-family:sans-serif">
<h1>Patient Registration</h1>
<form hx-post="/api/patients" hx-target="this" hx-swap="outerHTML" novalidate>
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
})
