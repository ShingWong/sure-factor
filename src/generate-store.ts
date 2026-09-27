import type { ColumnInfo } from './introspect.js'

export type SyncDirection = 'client-first' | 'server-first'
export type GenerationTier = 'vibe' | 'prototype' | 'production'

export interface StoreGenerationOptions {
  tableName: string
  columns: ColumnInfo[]
  tier: GenerationTier
  sync?: SyncDirection
  versioning?: boolean
  apiPath?: string
  entityName?: string
}

export interface GeneratedStoreOutput {
  interfaceCode: string
  storeCode: string
  apiCode: string
  fullCode: string
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/**
 * Render a value as a single-quoted TypeScript string literal.
 *
 * JSON.stringify is used deliberately: it is a correct JS/TS string escaper, so
 * it neutralises quotes, backslashes and line terminators. It cannot be used
 * inside a template literal, because it leaves `$` and `{` untouched and an
 * interpolated `${...}` would become live code in the generated file — use
 * `templateLiteral` for that case.
 */
function esc(val: string): string {
  return JSON.stringify(val)
}

/**
 * Render a value for interpolation into a template literal.
 *
 * Escapes backticks, backslashes and `${` so the text cannot terminate the
 * literal or open an interpolation. Newlines are escaped as well to keep the
 * generated source on one line.
 */
function templateLiteral(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function tsTypeFromSql(dataType: string, isNullable: boolean): string {
  const base = (() => {
    switch (dataType.toLowerCase()) {
      case 'integer':
      case 'bigint':
      case 'smallint':
      case 'serial':
      case 'bigserial':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'date':
      case 'timestamp':
      case 'timestamptz':
      case 'time':
        return 'string'
      case 'json':
      case 'jsonb':
        return 'Record<string, unknown>'
      case 'uuid':
        return 'string'
      default:
        return 'string'
    }
  })()
  return isNullable ? `${base} | null` : base
}

function generateEntityType(tableName: string, columns: ColumnInfo[]): string {
  const entityName = toPascalCase(tableName)
  const lines: string[] = [`export interface ${entityName} {`, `  id: string`]

  for (const col of columns) {
    if (col.columnName === 'id') continue
    const optional = col.isNullable ? '?' : ''
    const tsType = tsTypeFromSql(col.dataType, col.isNullable)
    lines.push(`  ${col.columnName}${optional}: ${tsType}`)
  }

  lines.push(`  createdAt?: string`, `  updatedAt?: string`, `}`)
  return lines.join('\n')
}

function generateApiAdapter(tableName: string, apiPath: string): string {
  const varName = toCamelCase(tableName)
  // `apiPath` is interpolated into both single-quoted literals and template
  // literals, so it needs an escaper per context. The old single `esc` covered
  // quotes and backticks but not `${`, letting a crafted path inject live code
  // into the generated file.
  const quotedPath = esc(apiPath)
  const interpolatedPath = templateLiteral(apiPath)
  return `
const ${varName}Api = {
  list: (): Promise<${toPascalCase(tableName)}[]> =>
    fetch(${quotedPath}).then(r => { if (!r.ok) throw new Error('Failed to fetch'); return r.json() }),

  getById: (id: string): Promise<${toPascalCase(tableName)}> =>
    fetch(\`${interpolatedPath}/\${id}\`).then(r => { if (!r.ok) throw new Error('Not found'); return r.json() }),

  create: (data: Partial<${toPascalCase(tableName)}>): Promise<${toPascalCase(tableName)}> =>
    fetch(${quotedPath}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) throw new Error('Failed to create'); return r.json() }),

  update: (id: string, data: Partial<${toPascalCase(tableName)}>): Promise<${toPascalCase(tableName)}> =>
    fetch(\`${interpolatedPath}/\${id}\`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) throw new Error('Failed to update'); return r.json() }),

  remove: (id: string): Promise<void> =>
    fetch(\`${interpolatedPath}/\${id}\`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error('Failed to delete'); return }),
}`.trim()
}

function generateStoreCode(tableName: string, options: StoreGenerationOptions): string {
  const entityName = toPascalCase(tableName)
  const varName = toCamelCase(tableName)
  const sync = options.sync ?? (options.tier === 'production' ? 'server-first' : 'client-first')
  const versioning = options.versioning ?? (options.tier === 'production')
  const configLines: string[] = [
    `  name: ${esc(tableName)},`,
    `  sync: ${esc(sync)},`,
    `  api: ${varName}Api,`,
  ]
  if (versioning) {
    configLines.push(`  versioning: true,`)
  }
  if (options.tier !== 'vibe') {
    configLines.push(`  onMutate: (event) => {`)
    configLines.push(`    console.debug(${esc(`[${entityName}]`)}, event.kind)`)
    configLines.push(`  },`)
  }

  return `
export const ${varName}Store = createEntityStore<${entityName}>(${options.tier === 'production' ? `{
${configLines.map(l => `  ${l}`).join('\n')}
}` : `{
${configLines.map(l => `  ${l}`).join('\n')}
}`})`.trim()
}

export function generateStore(options: StoreGenerationOptions): GeneratedStoreOutput {
  const { tableName, columns } = options
  // Pass the raw path through: generateApiAdapter applies the right escaper per
  // literal context. Escaping here as well would double-encode it.
  const rawPath = options.apiPath ?? `/api/${tableName}`
  const interfaceCode = generateEntityType(tableName, columns)
  const apiCode = generateApiAdapter(tableName, rawPath)
  const storeCode = generateStoreCode(tableName, options)

  const fullCode = [
    `import { createEntityStore } from 'sure-state'`,
    ``,
    interfaceCode,
    ``,
    apiCode,
    ``,
    storeCode,
    ``,
  ].join('\n')

  return { interfaceCode, storeCode, apiCode, fullCode }
}
