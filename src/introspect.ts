export interface ColumnInfo {
  columnName: string
  dataType: string
  isNullable: boolean
  maxLength: number | null
  defaultValue: string | null
  isPrimaryKey: boolean
  foreignKey: { table: string; column: string } | null
}

export interface TableInfo {
  tableName: string
  schema: string
  columns: ColumnInfo[]
}

export interface SchemaInfo {
  tables: TableInfo[]
}

export async function introspectSchema(connectionString: string, schemas: string[] = ['public']): Promise<SchemaInfo> {
  throw new Error('Not implemented yet — requires pg driver')
}

export function introspectSchemaFromDdl(ddl: string): SchemaInfo {
  const tables: TableInfo[] = []
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(\w+)\.)?(\w+)\s*\(([\s\S]*?)\);/gi
  let match: RegExpExecArray | null

  while ((match = tableRegex.exec(ddl)) !== null) {
    const schema = match[1]?.toLowerCase() ?? 'public'
    const tableName = match[2]!.toLowerCase()
    const columnBlock = match[3]!

    const columns: ColumnInfo[] = []
    const lines = columnBlock.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.toUpperCase().startsWith('CONSTRAINT') || trimmed.toUpperCase().startsWith('PRIMARY KEY') || trimmed.toUpperCase().startsWith('FOREIGN KEY') || trimmed.toUpperCase().startsWith('UNIQUE') || trimmed.toUpperCase().startsWith('CHECK') || trimmed.startsWith(')')) continue

      const parts = trimmed.split(/\s+/)
      if (parts.length < 2) continue
      const colName = parts[0]!
      const rawType = parts[1]!.toUpperCase()

      const maxLengthMatch = rawType.match(/VARCHAR\s*\(\s*(\d+)\s*\)/i)
      const maxLength = maxLengthMatch ? parseInt(maxLengthMatch[1]!, 10) : null
      const dataType = maxLengthMatch ? 'varchar' : rawType.includes('INT') || rawType.includes('SERIAL') ? 'integer' : rawType.includes('DATE') ? 'date' : rawType.includes('BOOL') ? 'boolean' : rawType.includes('UUID') ? 'uuid' : rawType.includes('JSON') ? 'json' : rawType.includes('TEXT') ? 'text' : rawType

      const originalRest = parts.slice(2).join(' ')
      const rest = originalRest.toUpperCase()
      const isNullable = !rest.includes('NOT NULL')
      const defaultValueMatch = originalRest.match(/DEFAULT\s+(\S+)/i)
      const defaultValue = defaultValueMatch ? defaultValueMatch[1]!.replace(/[,;]$/, '') : null
      const isPrimaryKey = rest.includes('PRIMARY KEY')

      const fkMatch = trimmed.match(/REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)/i)
      const foreignKey = fkMatch ? { table: fkMatch[1]!.toLowerCase(), column: fkMatch[2]!.toLowerCase() } : null

      columns.push({ columnName: colName, dataType, isNullable, maxLength, defaultValue, isPrimaryKey, foreignKey })
    }

    tables.push({ tableName, schema, columns })
  }

  return { tables }
}