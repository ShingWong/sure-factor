import type { ColumnInfo } from './introspect'

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

function esc(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/`/g, '\\`')
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
  const safePath = esc(apiPath)
  return `
const ${varName}Api = {
  list: (): Promise<${toPascalCase(tableName)}[]> =>
    fetch('${safePath}').then(r => { if (!r.ok) throw new Error('Failed to fetch'); return r.json() }),

  getById: (id: string): Promise<${toPascalCase(tableName)}> =>
    fetch(\`${safePath}/\${id}\`).then(r => { if (!r.ok) throw new Error('Not found'); return r.json() }),

  create: (data: Partial<${toPascalCase(tableName)}>): Promise<${toPascalCase(tableName)}> =>
    fetch('${safePath}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) throw new Error('Failed to create'); return r.json() }),

  update: (id: string, data: Partial<${toPascalCase(tableName)}>): Promise<${toPascalCase(tableName)}> =>
    fetch(\`${safePath}/\${id}\`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) throw new Error('Failed to update'); return r.json() }),

  remove: (id: string): Promise<void> =>
    fetch(\`${safePath}/\${id}\`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error('Failed to delete'); return }),
}`.trim()
}

function generateStoreCode(tableName: string, options: StoreGenerationOptions): string {
  const entityName = toPascalCase(tableName)
  const varName = toCamelCase(tableName)
  const sync = options.sync ?? (options.tier === 'production' ? 'server-first' : 'client-first')
  const versioning = options.versioning ?? (options.tier === 'production')
  const safeName = esc(tableName)
  const configLines: string[] = [
    `  name: '${safeName}',`,
    `  sync: '${sync}',`,
    `  api: ${varName}Api,`,
  ]
  if (versioning) {
    configLines.push(`  versioning: true,`)
  }
  if (options.tier !== 'vibe') {
    configLines.push(`  onMutate: (event) => {`)
    configLines.push(`    console.debug('[${entityName}]', event.kind)`)
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
  const safePath = options.apiPath ? esc(options.apiPath) : `/api/${tableName}`
  const interfaceCode = generateEntityType(tableName, columns)
  const apiCode = generateApiAdapter(tableName, safePath)
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
