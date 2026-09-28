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

/** Minimal shape of the `pg` query result this module needs. */
interface QueryResultLike {
  rows: unknown[]
}

/**
 * Accepts any object exposing `query`, so both `pg`'s `Client` and a plain test
 * double satisfy it. Row shapes are asserted at the mapping site instead of via
 * a generic, which `pg`'s overloaded `query` signature cannot express cleanly.
 */
interface Queryable {
  query(sql: string, values?: unknown[]): Promise<QueryResultLike>
  end?(): Promise<void>
}

/** Cast a driver row set for mapping; the SQL determines the row shape. */
function rows<TRow>(result: QueryResultLike): TRow[] {
  return result.rows as TRow[]
}

export class PostgresConnectionError extends Error {
  constructor(cause?: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`Could not connect to PostgreSQL: ${reason}. Check the connection string, or use introspectSchemaFromDdl() to introspect from a DDL string without a live connection.`, {
      cause,
    })
    this.name = 'PostgresConnectionError'
  }
}

/**
 * Introspect a live PostgreSQL database.
 *
 * Loads the `pg` driver lazily so it stays an optional dependency. `schemas`
 * is honoured rather than ignored: the catalog query is restricted to it, and
 * an empty list is rejected instead of silently introspecting everything.
 */
export async function introspectSchema(
  connectionString: string,
  schemas: string[] = ['public'],
  client?: Queryable
): Promise<SchemaInfo> {
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new TypeError('introspectSchema requires a non-empty connectionString')
  }
  if (!Array.isArray(schemas) || schemas.length === 0) {
    throw new TypeError('introspectSchema requires at least one schema name')
  }

  let queryable = client
  let shouldClose = false

  if (!queryable) {
    // `pg` is a regular dependency, so it is imported normally. The driver is
    // still loaded lazily (inside the function) to keep DDL-only usage from
    // paying for it at import time.
    const { Client } = await import('pg')
    const created = new Client({ connectionString })
    try {
      await created.connect()
    } catch (err) {
      // Close the half-open socket before surfacing the failure.
      await created.end().catch(() => undefined)
      throw new PostgresConnectionError(err)
    }
    queryable = created as unknown as Queryable
    shouldClose = true
  }

  try {
    const tableResult = await queryable.query(
      `SELECT table_schema, table_name
         FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema = ANY($1::text[])
        ORDER BY table_schema, table_name`,
      [schemas]
    )

    const columnResult = await queryable.query(
      `SELECT table_schema, table_name, column_name, data_type, is_nullable,
              character_maximum_length, column_default AS default_value, ordinal_position
         FROM information_schema.columns
        WHERE table_schema = ANY($1::text[])
        ORDER BY table_schema, table_name, ordinal_position`,
      [schemas]
    )

    const constraintResult = await queryable.query(
      `SELECT c.table_schema,
              c.table_name,
              c.column_name,
              (tc.constraint_type = 'PRIMARY KEY') AS primary_key,
              fcu.table_name AS foreign_table,
              fcu.column_name  AS foreign_column
         FROM information_schema.columns c
         LEFT JOIN information_schema.table_constraints tc
                ON tc.table_schema = c.table_schema
               AND tc.table_name  = c.table_name
               AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
         LEFT JOIN information_schema.key_column_usage kcu
                ON kcu.constraint_schema = tc.constraint_schema
               AND kcu.constraint_name   = tc.constraint_name
         LEFT JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_schema = tc.constraint_schema
               AND ccu.constraint_name   = tc.constraint_name
         LEFT JOIN information_schema.referential_constraints rc
                ON rc.constraint_schema = tc.constraint_schema
               AND rc.constraint_name   = tc.constraint_name
         LEFT JOIN information_schema.key_column_usage fcu
                ON fcu.constraint_schema = rc.unique_constraint_schema
               AND fcu.constraint_name   = rc.unique_constraint_name
        WHERE c.table_schema = ANY($1::text[])`,
      [schemas]
    )

    const keyOf = (s: string, t: string) => `${s}.${t}`

    const constraints = new Map<
      string,
      { primaryKey: boolean; foreignKey: { table: string; column: string } | null }
    >()
    for (const row of rows<{
      table_schema: string
      table_name: string
      column_name: string
      primary_key: boolean
      foreign_table: string | null
      foreign_column: string | null
    }>(constraintResult)) {
      const key = keyOf(row.table_schema, row.table_name)
      const existing = constraints.get(key) ?? { primaryKey: false, foreignKey: null }
      if (row.primary_key) existing.primaryKey = true
      if (row.foreign_table && row.foreign_column) {
        existing.foreignKey = { table: row.foreign_table, column: row.foreign_column }
      }
      constraints.set(key, existing)
    }

    const columnsByTable = new Map<string, ColumnInfo[]>()
    for (const row of rows<{
      table_schema: string
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
      character_maximum_length: number | null
      default_value: string | null
      ordinal_position: number
    }>(columnResult)) {
      const key = keyOf(row.table_schema, row.table_name)
      const meta = constraints.get(key)
      const list = columnsByTable.get(key) ?? []
      list.push({
        columnName: row.column_name,
        dataType: row.data_type,
        isNullable: row.is_nullable === 'YES',
        maxLength: row.character_maximum_length ?? null,
        defaultValue: row.default_value ?? null,
        isPrimaryKey: meta?.primaryKey ?? false,
        foreignKey: meta?.foreignKey ?? null,
      })
      columnsByTable.set(key, list)
    }

    const tables: TableInfo[] = rows<{ table_schema: string; table_name: string }>(tableResult).map(row => ({
      tableName: row.table_name,
      schema: row.table_schema,
      columns: columnsByTable.get(keyOf(row.table_schema, row.table_name)) ?? [],
    }))

    return { tables }
  } finally {
    // Only close a connection this call opened; an injected client stays the
    // caller's responsibility.
    if (shouldClose) await queryable.end?.()
  }
}

const IDENT = '"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*'
const QUALIFIED = `(?:${IDENT}\\s*\\.\\s*)?${IDENT}`

/** Strip surrounding double quotes and unescape doubled quotes. */
function unquoteIdent(ident: string): string {
  const v = ident.trim()
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v.slice(1, -1).replace(/""/g, '"')
  }
  return v
}

// A schema qualifier is captured as its own group. `QUALIFIED` cannot be used
// for the head because the table name must remain group 2; note the qualifier
// group allows whitespace around the dot but the table name may not absorb it.
const TABLE_HEAD_RE = new RegExp(
  `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})\\s*\\.\\s*(${IDENT})`,
  'gi'
)
const UNQUALIFIED_TABLE_RE = new RegExp(
  `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`,
  'gi'
)

/** Locate the `(` that opens a table's column block. */
function findOpenParen(ddl: string, from: number): number {
  for (let i = from; i < ddl.length; i++) {
    if (ddl[i] === '(') return i
  }
  return -1
}

/**
 * Read a balanced parenthesised block starting at `start` (which must index the
 * opening paren), skipping over string and quoted-identifier literals.
 *
 * A non-greedy `\(([\s\S]*?)\)` cannot be used here: it stops at the first
 * `)`, which is usually inside `VARCHAR(255)` or `DEFAULT NOW()`, truncating
 * every multi-column table.
 */
function readBalancedBlock(ddl: string, start: number): { body: string; end: number } | null {
  if (ddl[start] !== '(') return null
  let depth = 0
  let i = start
  while (i < ddl.length) {
    const ch = ddl[i]!
    if (ch === "'" || ch === '"') {
      const quote = ch
      i++
      while (i < ddl.length) {
        if (ddl[i] === quote) {
          if (ddl[i + 1] === quote) {
            i += 2
            continue
          }
          break
        }
        i++
      }
      i++
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return { body: ddl.slice(start + 1, i), end: i + 1 }
    }
    i++
  }
  return null
}

/**
 * Split a column block on top-level commas, so `DECIMAL(10, 2)` stays intact.
 *
 * Quoted-identifier literals are skipped. A double quote is only an identifier
 * delimiter at the start of a token: inside `VARCHAR(255) DEFAULT 'a"b(c)'` the
 * quote belongs to a string literal and must not open a quoted identifier, or
 * the following comma would be misread as a column separator.
 */
function splitTopLevel(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (ch === "'") {
      current += ch
      i++
      while (i < body.length) {
        current += body[i]!
        if (body[i] === "'") {
          if (body[i + 1] === "'") {
            current += body[i + 1]!
            i++
          } else break
        }
        i++
      }
      continue
    }
    if (ch === '"') {
      current += ch
      i++
      while (i < body.length) {
        current += body[i]!
        if (body[i] === '"') {
          if (body[i + 1] === '"') {
            current += body[i + 1]!
            i++
          } else break
        }
        i++
      }
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current)
  return out
}

/**
 * Split a column definition into name, type and the remainder.
 *
 * Returns the *raw* name text (quotes intact) so `"user data"` survives
 * whitespace splitting, which would otherwise cut the name at the space.
 */
function splitColumnDef(trimmed: string): { name: string; type: string; rest: string } | null {
  let i = 0
  let name = ''

  if (trimmed.startsWith('"')) {
    i = 1
    while (i < trimmed.length) {
      if (trimmed[i] === '"') {
        if (trimmed[i + 1] === '"') {
          name += '""'
          i += 2
          continue
        }
        i++
        break
      }
      name += trimmed[i]
      i++
    }
  } else {
    while (i < trimmed.length && !/\s/.test(trimmed[i]!)) {
      name += trimmed[i]
      i++
    }
  }

  if (!name) return null
  while (i < trimmed.length && /\s/.test(trimmed[i]!)) i++

  let type = ''
  if (trimmed.startsWith('"', i)) {
    i++
    while (i < trimmed.length) {
      if (trimmed[i] === '"') {
        if (trimmed[i + 1] === '"') {
          type += '""'
          i += 2
          continue
        }
        i++
        break
      }
      type += trimmed[i]
      i++
    }
  } else {
    while (i < trimmed.length && !/\s/.test(trimmed[i]!)) {
      type += trimmed[i]
      i++
    }
  }

  if (!type) return null
  const rest = trimmed.slice(i).trim()
  return { name, type, rest }
}

export function introspectSchemaFromDdl(ddl: string): SchemaInfo {
  const tables: TableInfo[] = []
  // Quoted identifiers are matched and unquoted, so names like "user data" or
  // "User" survive. The column block is read with balanced-paren scanning, and
  // the trailing semicolon is optional, so a final statement without a
  // terminator (or one followed by a comment) still parses.
  TABLE_HEAD_RE.lastIndex = 0
  UNQUALIFIED_TABLE_RE.lastIndex = 0

  // Walk both patterns in step and take whichever matched earliest, so a
  // schema-qualified name is not mistaken for an unqualified one.
  let nextQualified = TABLE_HEAD_RE.exec(ddl)
  let nextPlain = UNQUALIFIED_TABLE_RE.exec(ddl)

  for (;;) {
    const useQualified = nextQualified !== null && (nextPlain === null || nextQualified.index <= nextPlain.index)
    const match: RegExpExecArray | null = useQualified ? nextQualified : nextPlain
    if (!match) break

    const schema = useQualified && match[1] !== undefined ? unquoteIdent(match[1]).toLowerCase() : null
    // The table name may be followed by whitespace before the column block, so
    // the opening paren is located rather than assumed.
    const openIdx = findOpenParen(ddl, match.index + match[0].length)
    if (openIdx === -1) break
    const block = readBalancedBlock(ddl, openIdx)
    if (!block) break

    if (useQualified) {
      TABLE_HEAD_RE.lastIndex = block.end
      nextQualified = TABLE_HEAD_RE.exec(ddl)
    } else {
      UNQUALIFIED_TABLE_RE.lastIndex = block.end
      nextPlain = UNQUALIFIED_TABLE_RE.exec(ddl)
    }

    // Group 1 is the schema (qualified pattern) or the table name (plain
    // pattern); group 2 is the table name only for the qualified pattern.
    const rawName = useQualified ? match[2] : match[1]
    if (rawName === undefined) break
    const tableName = unquoteIdent(rawName).toLowerCase()

    const columns: ColumnInfo[] = []
    for (const rawPart of splitTopLevel(block.body)) {
      // Collapse newlines so a multi-line column definition reads as one unit.
      const trimmed = rawPart.replace(/\s+/g, ' ').trim()
      if (!trimmed) continue
      const upper = trimmed.toUpperCase()
      if (
        upper.startsWith('CONSTRAINT') ||
        upper.startsWith('PRIMARY KEY') ||
        upper.startsWith('FOREIGN KEY') ||
        upper.startsWith('UNIQUE') ||
        upper.startsWith('CHECK') ||
        upper.startsWith('EXCLUDE')
      ) {
        continue
      }

      // A quoted name may contain spaces ("user data"), so the definition is
      // tokenised with quote awareness instead of split(/\s+/).
      const parsed = splitColumnDef(trimmed)
      if (!parsed) continue
      const colName = unquoteIdent(parsed.name)
      const rawType = parsed.type.toUpperCase()

      const maxLengthMatch = rawType.match(/VARCHAR\s*\(\s*(\d+)\s*\)/i)
      const maxLength = maxLengthMatch ? parseInt(maxLengthMatch[1]!, 10) : null
      // Type inference is ordered, and each test is deliberately narrow.
      //
      // Word boundaries alone are not enough: BIGSERIAL must normalise to
      // 'integer' even though SERIAL is mid-word, while CITEXT must NOT
      // normalise to 'text' for the same reason. So the integer test uses
      // explicit alternatives, and the time test runs first because
      // TIMESTAMPTZ contains TIMESTAMP, which contains DATE.
      //
      // Time types are returned raw on purpose. A timestamp is not a date, and
      // the `date-iso` catalog type matches only `data_type = 'date'`, so
      // reporting 'date' for a timestamp column would attach a date-only
      // validation regex to it. Types with no catalog equivalent (TIMESTAMPTZ,
      // CITEXT) also fall through, which is more honest than mislabelling them.
      // No leading \b on SERIAL: in BIGSERIAL / SMALLSERIAL it is mid-word, and
      // a boundary there would miss the most common auto-increment spelling.
      const isIntegerType =
        /\b(?:TINYINT|SMALLINT|MEDIUMINT|INTEGER|INT|BIGINT)\b|SERIAL/.test(rawType)
      const isTimeType = /\b(?:TIMESTAMPTZ|TIMESTAMP|TIME)\b/.test(rawType)
      const dataType = maxLengthMatch
        ? 'varchar'
        : isTimeType
          ? rawType
          : isIntegerType
            ? 'integer'
            : /\bDATE\b/.test(rawType)
              ? 'date'
              : /\bBOOL/.test(rawType)
                ? 'boolean'
                : /\bUUID\b/.test(rawType)
                  ? 'uuid'
                  : /\bJSON/.test(rawType)
                    ? 'json'
                    : /\bTEXT\b/.test(rawType)
                      ? 'text'
                      : rawType

      const originalRest = parsed.rest
      const rest = originalRest.toUpperCase()
      const isNullable = !/\bNOT\s+NULL\b/i.test(rest)
      // Capture a balanced call such as DEFAULT NOW() rather than stopping at
      // its first ')'.
      const defaultValueMatch =
        /\bDEFAULT\s+('(?:[^']|'')*'|"(?:[^"]|"")*"|[A-Za-z_][\w$]*(?:\s*\([^)]*\))?|-?[\d.]+|true|false)/i.exec(
          originalRest
        )
      const defaultValue = defaultValueMatch ? defaultValueMatch[1]! : null
      const isPrimaryKey = /\bPRIMARY\s+KEY\b/i.test(rest)

      const fkMatch = new RegExp(`REFERENCES\\s+(${QUALIFIED})\\s*\\(\\s*(${IDENT})\\s*\\)`, 'i').exec(trimmed)
      const foreignKey = fkMatch
        ? { table: unquoteIdent(fkMatch[1]!).toLowerCase(), column: unquoteIdent(fkMatch[2]!).toLowerCase() }
        : null

      columns.push({ columnName: colName, dataType, isNullable, maxLength, defaultValue, isPrimaryKey, foreignKey })
    }

    tables.push({ tableName, schema: schema ?? 'public', columns })
  }

  return { tables }
}