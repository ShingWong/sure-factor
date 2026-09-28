import { describe, it, expect } from 'vitest'
import { introspectSchema, introspectSchemaFromDdl } from './introspect.js'

describe('introspectSchemaFromDdl', () => {
  it('parses a simple CREATE TABLE', () => {
    const ddl = `CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(100) NOT NULL,
      zip VARCHAR(10)
    );`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables).toHaveLength(1)
    expect(schema.tables[0]!.tableName).toBe('users')
    expect(schema.tables[0]!.schema).toBe('public')
  })

  it('parses all column types correctly', () => {
    const ddl = `CREATE TABLE types_test (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      age INTEGER,
      active BOOLEAN DEFAULT true,
      uid UUID NOT NULL,
      bio TEXT,
      metadata JSON,
      created_at DATE DEFAULT CURRENT_DATE
    );`
    const schema = introspectSchemaFromDdl(ddl)
    const cols = schema.tables[0]!.columns
    expect(cols).toHaveLength(8)

    expect(cols[0]!.columnName).toBe('id')
    expect(cols[0]!.dataType).toBe('integer')
    expect(cols[0]!.isPrimaryKey).toBe(true)

    expect(cols[1]!.columnName).toBe('name')
    expect(cols[1]!.dataType).toBe('varchar')
    expect(cols[1]!.maxLength).toBe(100)
    expect(cols[1]!.isNullable).toBe(false)

    expect(cols[2]!.columnName).toBe('age')
    expect(cols[2]!.dataType).toBe('integer')
    expect(cols[2]!.isNullable).toBe(true)

    expect(cols[3]!.columnName).toBe('active')
    expect(cols[3]!.dataType).toBe('boolean')

    expect(cols[4]!.columnName).toBe('uid')
    expect(cols[4]!.dataType).toBe('uuid')

    expect(cols[5]!.columnName).toBe('bio')
    expect(cols[5]!.dataType).toBe('text')
    expect(cols[5]!.maxLength).toBeNull()

    expect(cols[6]!.columnName).toBe('metadata')
    expect(cols[6]!.dataType).toBe('json')

    expect(cols[7]!.columnName).toBe('created_at')
    expect(cols[7]!.dataType).toBe('date')
  })

  it('detects nullable vs NOT NULL', () => {
    const ddl = `CREATE TABLE test (
      a INT NOT NULL,
      b INT,
      c INT NOT NULL
    );`
    const cols = introspectSchemaFromDdl(ddl).tables[0]!.columns
    expect(cols[0]!.isNullable).toBe(false)
    expect(cols[1]!.isNullable).toBe(true)
    expect(cols[2]!.isNullable).toBe(false)
  })

  it('detects primary key', () => {
    const ddl = `CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50)
    );`
    const cols = introspectSchemaFromDdl(ddl).tables[0]!.columns
    expect(cols[0]!.isPrimaryKey).toBe(true)
    expect(cols[1]!.isPrimaryKey).toBe(false)
  })

  it('detects foreign keys', () => {
    const ddl = `CREATE TABLE orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id)
    );`
    const cols = introspectSchemaFromDdl(ddl).tables[0]!.columns
    expect(cols[1]!.foreignKey).toEqual({ table: 'users', column: 'id' })
  })

  it('detects default values', () => {
    const ddl = `CREATE TABLE test (
      id SERIAL,
      created_at TIMESTAMP DEFAULT NOW(),
      active BOOLEAN DEFAULT true
    );`
    const cols = introspectSchemaFromDdl(ddl).tables[0]!.columns
    expect(cols[1]!.defaultValue).toBe('NOW()')
    expect(cols[2]!.defaultValue).toBe('true')
  })

  it('handles schema-qualified table names', () => {
    const ddl = `CREATE TABLE public.users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255)
    );`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables[0]!.schema).toBe('public')
    expect(schema.tables[0]!.tableName).toBe('users')
  })

  it('handles IF NOT EXISTS', () => {
    const ddl = `CREATE TABLE IF NOT EXISTS users (id SERIAL);`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables).toHaveLength(1)
    expect(schema.tables[0]!.tableName).toBe('users')
  })

  it('handles multiple tables', () => {
    const ddl = `CREATE TABLE users (id SERIAL);
                 CREATE TABLE orders (id SERIAL);`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables).toHaveLength(2)
  })

  it('skips constraints and index statements', () => {
    const ddl = `CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      CONSTRAINT unique_email UNIQUE (email)
    );`
    const cols = introspectSchemaFromDdl(ddl).tables[0]!.columns
    expect(cols).toHaveLength(2)
    expect(cols[0]!.columnName).toBe('id')
    expect(cols[1]!.columnName).toBe('email')
  })

  it('returns empty for empty input', () => {
    const schema = introspectSchemaFromDdl('')
    expect(schema.tables).toHaveLength(0)
  })

  it('returns empty for malformed input', () => {
    const schema = introspectSchemaFromDdl('this is not SQL')
    expect(schema.tables).toHaveLength(0)
  })

  it('does not collapse timestamp types into a date', () => {
    // TIMESTAMPTZ contains TIMESTAMP, and TIMESTAMP contains DATE. A timestamp
    // is not a date: the date-iso catalog type matches only data_type = 'date',
    // so reporting 'date' here would attach a date-only validation regex to a
    // timestamp column.
    const ddl = `CREATE TABLE events (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP WITH TIME ZONE,
      starts_at TIME,
      born_on DATE,
      day DATE
    );`
    const byName = Object.fromEntries(
      introspectSchemaFromDdl(ddl).tables[0]!.columns.map(c => [c.columnName, c.dataType])
    )
    expect(byName.created_at).toBe('TIMESTAMPTZ')
    expect(byName.updated_at).toBe('TIMESTAMP')
    expect(byName.deleted_at).toBe('TIMESTAMP')
    expect(byName.starts_at).toBe('TIME')
    // Real dates still normalise.
    expect(byName.born_on).toBe('date')
    expect(byName.day).toBe('date')
  })

  it('does not let a timestamp type match the date catalog type', () => {
    // Guards the actual downstream consequence: date-iso matches on
    // data_type = 'date', so a timestamp reported as 'date' would be given a
    // date-only validation regex.
    const ddl = `CREATE TABLE events (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`
    const createdAt = introspectSchemaFromDdl(ddl).tables[0]!.columns[1]!
    expect(createdAt.dataType).not.toBe('date')
  })

  it('keeps integer, boolean and uuid distinct from timestamp types', () => {
    const ddl = `CREATE TABLE t (
      a INTEGER,
      b SERIAL,
      c BOOLEAN,
      d UUID,
      e TIMESTAMPTZ
    );`
    const types = introspectSchemaFromDdl(ddl).tables[0]!.columns.map(c => c.dataType)
    expect(types).toEqual(['integer', 'integer', 'boolean', 'uuid', 'TIMESTAMPTZ'])
  })

  it('normalises every integer spelling, including BIGSERIAL', () => {
    // SERIAL is mid-word in BIGSERIAL, so a bare \bSERIAL\b test would miss it
    // and fall through to the raw type.
    const ddl = `CREATE TABLE t (
      a INT,
      b INTEGER,
      c SMALLINT,
      d BIGINT,
      e SERIAL,
      f BIGSERIAL,
      g SMALLSERIAL,
      h SERIAL8
    );`
    const types = introspectSchemaFromDdl(ddl).tables[0]!.columns.map(c => c.dataType)
    expect(types).toEqual(Array(8).fill('integer'))
  })

  it('does not treat CITEXT as text', () => {
    // TEXT is mid-word in CITEXT, and a case-insensitive text type is not a
    // plain text type, so it must not pick up the `text` catalog type.
    const ddl = `CREATE TABLE t (
      a CITEXT NOT NULL,
      b TEXT,
      c VARCHAR(50)
    );`
    const types = introspectSchemaFromDdl(ddl).tables[0]!.columns.map(c => c.dataType)
    expect(types).toEqual(['CITEXT', 'text', 'varchar'])
  })

  it('parses a table whose final statement has no trailing semicolon', () => {
    const ddl = `CREATE TABLE a (id SERIAL PRIMARY KEY, name VARCHAR(50))`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables).toHaveLength(1)
    expect(schema.tables[0]!.columns).toHaveLength(2)
  })

  it('parses quoted and mixed-case identifiers', () => {
    const ddl = `CREATE TABLE "User" (
      "user data" VARCHAR(255) NOT NULL,
      id SERIAL PRIMARY KEY
    );`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables[0]!.tableName).toBe('user')
    expect(schema.tables[0]!.columns[0]!.columnName).toBe('user data')
  })

  it('parses a schema-qualified quoted table name', () => {
    const ddl = `CREATE TABLE "app"."User" (id SERIAL PRIMARY KEY);`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables[0]!.schema).toBe('app')
    expect(schema.tables[0]!.tableName).toBe('user')
  })

  it('does not truncate a column block at a paren inside a type', () => {
    // VARCHAR(255) and DECIMAL(10, 2) contain ')' — a non-greedy regex stops there.
    const ddl = `CREATE TABLE t (
      a VARCHAR(255) NOT NULL,
      b DECIMAL(10, 2),
      c TIMESTAMP DEFAULT NOW()
    );`
    const cols = introspectSchemaFromDdl(ddl).tables[0]!.columns
    expect(cols).toHaveLength(3)
    expect(cols.map(c => c.columnName)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a full function call as the default value', () => {
    const ddl = `CREATE TABLE t (
      id SERIAL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`
    const cols = introspectSchemaFromDdl(ddl).tables[0]!.columns
    expect(cols[1]!.defaultValue).toBe('NOW()')
    expect(cols[2]!.defaultValue).toBe('CURRENT_TIMESTAMP')
  })

  it('keeps a paren inside a string default intact', () => {
    const ddl = `CREATE TABLE t (
      id SERIAL,
      label VARCHAR(50) DEFAULT 'a(b)c',
      other INT NOT NULL
    );`
    const cols = introspectSchemaFromDdl(ddl).tables[0]!.columns
    expect(cols).toHaveLength(3)
    expect(cols[1]!.defaultValue).toBe("'a(b)c'")
    expect(cols[2]!.columnName).toBe('other')
  })

  it('parses a table followed by a trailing comment', () => {
    const ddl = `CREATE TABLE t (id SERIAL PRIMARY KEY, name TEXT)
-- trailing comment`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables).toHaveLength(1)
    expect(schema.tables[0]!.columns).toHaveLength(2)
  })

  it('parses multiple tables each with parenthesised types', () => {
    const ddl = `CREATE TABLE a (id SERIAL PRIMARY KEY, name VARCHAR(10));
                 CREATE TABLE b (id SERIAL PRIMARY KEY, total DECIMAL(10, 2));`
    const schema = introspectSchemaFromDdl(ddl)
    expect(schema.tables).toHaveLength(2)
    expect(schema.tables[1]!.columns).toHaveLength(2)
  })
})

describe('introspectSchema argument validation', () => {
  it('rejects an empty connection string', async () => {
    await expect(introspectSchema('')).rejects.toThrow(TypeError)
  })

  it('rejects an empty schema list rather than introspecting everything', async () => {
    await expect(introspectSchema('postgres://x', [])).rejects.toThrow(TypeError)
  })

  it('surfaces an actionable error when the database is unreachable', async () => {
    // Port 1 is reserved and refuses connections.
    await expect(introspectSchema('postgres://127.0.0.1:1/none', ['public'])).rejects.toThrow(
      /Could not connect to PostgreSQL/
    )
  })

  it('does not silently swallow a failure', async () => {
    await expect(introspectSchema('postgres://127.0.0.1:1/none', ['public'])).rejects.toThrow()
  })

  it('uses an injected client and returns mapped tables', async () => {
    const calls: string[] = []
    const sentValues: unknown[] = []
    const fake = {
      async query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
        calls.push(sql)
        sentValues.push(values)
        if (sql.includes('information_schema.tables')) {
          return { rows: [{ table_schema: 'public', table_name: 'users' }] }
        }
        // The constraint query also reads information_schema.columns, so it must
        // be matched first.
        if (sql.includes('table_constraints')) {
          return {
            rows: [
              {
                table_schema: 'public',
                table_name: 'users',
                column_name: 'id',
                primary_key: true,
                foreign_table: null,
                foreign_column: null,
              },
            ],
          }
        }
        if (sql.includes('information_schema.columns')) {
          return {
            rows: [
              {
                table_schema: 'public',
                table_name: 'users',
                column_name: 'id',
                data_type: 'integer',
                is_nullable: 'NO',
                character_maximum_length: null,
                default_value: null,
                ordinal_position: 1,
              },
              {
                table_schema: 'public',
                table_name: 'users',
                column_name: 'email',
                data_type: 'character varying',
                is_nullable: 'YES',
                character_maximum_length: 255,
                default_value: null,
                ordinal_position: 2,
              },
            ],
          }
        }
        return { rows: [{ table_schema: 'public', table_name: 'users', column_name: 'id', primary_key: true, foreign_table: null, foreign_column: null }] }
      },
    }
    const result = await introspectSchema('postgres://unused', ['public'], fake)
    expect(result.tables).toHaveLength(1)
    expect(result.tables[0]!.tableName).toBe('users')
    expect(result.tables[0]!.columns).toHaveLength(2)
    const id = result.tables[0]!.columns[0]!
    expect(id.columnName).toBe('id')
    expect(id.isNullable).toBe(false)
    expect(id.isPrimaryKey).toBe(true)
    const email = result.tables[0]!.columns[1]!
    expect(email.maxLength).toBe(255)
    // The schema filter must be passed through as a bound parameter rather than
    // interpolated into the SQL. Every catalog query must carry it.
    const selectQueries = calls.filter(c => c.trimStart().toUpperCase().startsWith('SELECT'))
    expect(selectQueries.length).toBe(3)
    for (const sql of selectQueries) {
      expect(sql, 'schema filter missing').toContain('ANY($1::text[])')
    }
    // Every query must bind the requested schemas as $1.
    expect(sentValues).toHaveLength(3)
    for (const v of sentValues) {
      expect(v).toEqual([['public']])
    }
  })

  it('does not close a client it did not create', async () => {
    let closed = false
    const fake = {
      async query(): Promise<{ rows: unknown[] }> {
        return { rows: [] }
      },
      async end() {
        closed = true
      },
    }
    await introspectSchema('postgres://unused', ['public'], fake)
    expect(closed).toBe(false)
  })
})