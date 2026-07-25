import { describe, it, expect } from 'vitest'
import { introspectSchemaFromDdl } from './introspect'

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
})