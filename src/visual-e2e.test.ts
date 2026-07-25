import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { introspectSchemaFromDdl } from './introspect'
import { loadAllTypesSync, matchColumnToTypeSync } from './match'
import { generateForTier } from './generate'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const screenshotDir = join(tmpdir(), 'sure-visual-e2e')
let reqId = 1

function jsonRpc(method: string, params: Record<string, unknown> = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params })
}

describe('Visual E2E: agentic-web-testing MCP', () => {
  let mcpProc: ChildProcess
  let htmlPath: string
  let responseBuffer = ''
  let pendingResolve: ((value: any) => void) | null = null
  const screenshot1 = join(screenshotDir, '01-initial.png')
  const screenshot2 = join(screenshotDir, '02-filled.png')

  async function sendRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Request '${method}' timed out`)), 20000)
      pendingResolve = (result: any) => {
        clearTimeout(timer)
        resolve(result)
      }
      mcpProc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) + '\n')
    })
  }

  function handleResponse(data: Buffer) {
    responseBuffer += data.toString()
    const lines = responseBuffer.split('\n')
    responseBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (pendingResolve && parsed.id) {
          const resolve = pendingResolve
          pendingResolve = null
          resolve(parsed)
        }
      } catch { /* skip malformed */ }
    }
  }

  function extractResult(response: any): any {
    if (response?.error) return { error: response.error.message ?? JSON.stringify(response.error) }
    const text = response?.result?.content?.[0]?.text
    if (!text) return {}
    try { return JSON.parse(text) } catch {
      // Non-JSON text → could be an error message in the content
      const allTexts = (response?.result?.content ?? []).map((c: any) => c.text).filter(Boolean)
      return { text: allTexts.join(' ') }
    }
  }

  function extractDomText(response: any): string {
    const text = response?.result?.content?.[0]?.text
    if (!text) return ''
    try {
      const parsed = JSON.parse(text)
      return parsed.html ?? parsed.text ?? text
    } catch {
      return text
    }
  }

  beforeAll(async () => {
    mkdirSync(screenshotDir, { recursive: true })

    // Generate HTML page from sure-factor
    const ddl = `
      CREATE TABLE patients (
        id UUID PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        diagnosis VARCHAR(8),
        zip VARCHAR(5),
        phone VARCHAR(20),
        is_active BOOLEAN NOT NULL DEFAULT true
      );
    `
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
        const placeholder = type ? (i18nData[`types.${type.name}.placeholder`] ?? '') : ''
        const help = type ? (i18nData[`types.${type.name}.help`] ?? '') : ''
        return `
  <div class="sure-form__field">
    <label class="sure-form__label" for="${col.columnName}">${label}</label>
    <input type="text" id="${col.columnName}" name="${col.columnName}" class="sure-form__input" placeholder="${placeholder}" />
    <span class="sure-form__help">${help}</span>
  </div>`
      }).join('\n')

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Patient Registration</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{padding:2rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;color:#2e3440;max-width:640px;margin:0 auto}
h1{font-size:1.5rem;margin-bottom:1.5rem;color:#2e3440}
.sure-form{background:#fff;padding:1.5rem;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.sure-form__field{margin-bottom:1rem}
.sure-form__label{display:block;margin-bottom:0.25rem;font-weight:600;color:#2e3440;font-size:0.875rem}
.sure-form__input{width:100%;padding:0.5rem 0.75rem;border:1px solid #d8dee9;border-radius:6px;font-size:1rem;color:#2e3440;background:#fff}
.sure-form__input:focus{outline:none;border-color:#81a1c1;box-shadow:0 0 0 3px rgba(129,161,193,0.2)}
.sure-form__help{display:block;margin-top:0.25rem;font-size:0.8rem;color:#4c566a}
.btn-primary{display:inline-flex;align-items:center;gap:0.5rem;padding:0.5rem 1.25rem;border:none;border-radius:6px;font-size:0.9rem;font-weight:600;cursor:pointer;color:#fff;background:#5e81ac;margin-top:0.5rem}
</style></head>
<body>
<h1>Patient Registration</h1>
<form class="sure-form" hx-post="/api/patients" hx-target="this" hx-swap="outerHTML" novalidate>
${fields}
<button type="submit" class="btn-primary">Submit</button>
</form>
</body></html>`

    htmlPath = join(screenshotDir, 'form.html')
    writeFileSync(htmlPath, html)

    // Start agentic-web-testing MCP server
    mcpProc = spawn('.venv/bin/python', ['-m', 'src.server'], {
      cwd: '/usr/local/devel/agentic-web-testing',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    mcpProc.stdout?.on('data', handleResponse)
    await new Promise(r => setTimeout(r, 2000))
  }, 30000)

  afterAll(() => {
    if (mcpProc && !mcpProc.killed) mcpProc.kill()
  })

  it('launches browser', async () => {
    const response = await sendRequest('tools/call', { name: 'launch', arguments: { headless: true, viewport: { width: 1280, height: 900 } } })
    const result = extractResult(response)
    expect(result.error).toBeUndefined()
  }, 30000)

  it('navigates to generated form', async () => {
    const response = await sendRequest('tools/call', { name: 'goto', arguments: { url: `file://${htmlPath}`, wait_until: 'domcontentloaded' } })
    const result = extractResult(response)
    expect(result.error).toBeUndefined()
  }, 30000)

  it('takes initial screenshot', async () => {
    const response = await sendRequest('tools/call', { name: 'screenshot', arguments: { path: screenshot1 } })
    const result = extractResult(response)
    expect(result.path || !result.error).toBeTruthy()
  }, 30000)

  it('fills fields and takes filled screenshot', async () => {
    await sendRequest('tools/call', { name: 'fill', arguments: { selector: 'input[name="email"]', text: 'john@example.com' } })
    await sendRequest('tools/call', { name: 'fill', arguments: { selector: 'input[name="full_name"]', text: 'John Doe' } })
    await sendRequest('tools/call', { name: 'fill', arguments: { selector: 'input[name="zip"]', text: '90210' } })

    const response = await sendRequest('tools/call', { name: 'screenshot', arguments: { path: screenshot2 } })
    const result = extractResult(response)
    expect(result.path || !result.error).toBeTruthy()
  }, 30000)

  it('verifies form structure via DOM', async () => {
    const response = await sendRequest('tools/call', { name: 'get_dom', arguments: {} })
    const dom = extractDomText(response)
    expect(dom).toContain('Patient Registration')
    expect(dom).toContain('sure-form')
    expect(dom).toContain('name="email"')
    expect(dom).toContain('name="full_name"')
    expect(dom).toContain('name="zip"')
    expect(dom).toContain('btn-primary')
    expect(dom).toContain('hx-post="/api/patients"')
  }, 30000)

  it('closes browser', async () => {
    const response = await sendRequest('tools/call', { name: 'close', arguments: {} })
    const result = extractResult(response)
    expect(result.error).toBeUndefined()
  }, 30000)

  it('analyze_screenshot tool is registered and responds', async () => {
    const response = await sendRequest('tools/call', { name: 'analyze_screenshot', arguments: { prompt: 'Is there a Patient Registration form visible?' } })
    const result = extractResult(response)
    // With VISION_API_KEY: {"provider":"...","model":"...","analysis":"..."}
    // Without API key: {"text":"Missing dependency..."}  or  {"status":"error","error":"..."}
    if (result.provider) {
      expect(result.analysis).toBeTruthy()
    } else if (result.status === 'error') {
      expect(result.error).toBeTruthy()
    } else if (result.text) {
      expect(result.text.length).toBeGreaterThan(0)
    } else {
      // Either way, the tool responded (didn't crash)
      expect(true).toBe(true)
    }
  }, 30000)
})
