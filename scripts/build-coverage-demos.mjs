#!/usr/bin/env node
/** Generate one standalone browser demo per built-in catalog component.
 *
 * Each demo is the *real* generated client module (transpiled from TypeScript
 * with the compiler API, not hand-written), mounted with a minimal synthetic
 * spec. It is the demo and browser-structure evidence used by the Phase D
 * coverage matrix in sure-store/components/coverage.json.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { generateClientComponent } from '../dist/generate-client.js'
import { introspectSchemaFromDdl } from '../dist/introspect.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'e2e', 'demos')
const DDL = `
  CREATE TABLE probe (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    items TEXT
  );
`

function bootFor(kind) {
  if (kind === 'renderForm') {
    return `const spec = {
  id: 'probe', title: 'Probe form',
  fields: [{ name: 'email', label: 'Email', help: '', required: true,
    control: 'text', inputType: 'email', type: 'text', validation: {}, hints: {},
    sanitize: [], source: { table: 'probe', column: 'email' } }]
};
document.getElementById('app').appendChild(renderForm(spec, { onChange() {}, onSubmit() {} }));`
  }
  if (kind === 'renderTable') {
    return `document.getElementById('app').appendChild(renderTable({
  columns: [{ name: 'email', label: 'Email' }],
  rows: [{ id: '1', email: 'test@example.com' }]
}));`
  }
  return `document.getElementById('app').appendChild(renderMenu({
  items: [{ id: 'one', label: 'One', title: 'One' }, { id: 'two', label: 'Two', title: 'Two' }],
  label: 'Probe menu'
}));`
}

mkdirSync(OUT, { recursive: true })
const names = readdirSync(join(ROOT, 'catalog', 'components'))
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => name.replace(/\.yaml$/, ''))
  .sort()

const links = []
for (const name of names) {
  const generated = generateClientComponent(introspectSchemaFromDdl(DDL), {
    tier: 'production',
    component: name,
    exportName: 'DemoRenderer',
  })
  const kind = ['renderForm', 'renderTable', 'renderMenu']
    .find((candidate) => generated.module.includes(`export function ${candidate}(`))
  if (!kind) throw new Error(`${name}: no renderer found`)
  const js = ts.transpileModule(generated.module, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  writeFileSync(join(OUT, `${name}.js`), js)
  // Inline the compiled module: Chromium refuses ES-module imports over file://,
  // and the demos must open without a dev server.
  writeFileSync(join(OUT, `${name}.html`), `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${name} — sure-factor demo</title></head>
<body>
<h1>${name}</h1>
<div id="app"></div>
<script type="module">
${js}
${bootFor(kind)}
</script>
</body>
</html>
`)
  links.push(`<li><a href="${name}.html">${name}</a> (${kind})</li>`)
}

writeFileSync(join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>sure-factor component demos</title></head>
<body><h1>Component demos</h1><ul>${links.join('\n')}</ul></body>
</html>
`)
console.log(`generated ${names.length} demos in e2e/demos/`)
