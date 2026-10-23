import { readdirSync, readFileSync } from 'fs'
import type { ColumnInfo } from './introspect.js'
import type { CatalogType } from './types.js'
import { parseYaml } from './parse-yaml.js'

export interface TypeMatchResult {
  type: CatalogType
  confidence: number
}

async function loadType(name: string): Promise<CatalogType | null> {
  try {
    const fs = await import('fs/promises')
    const yamlText = await fs.readFile(new URL(`../catalog/types/${name}.yaml`, import.meta.url), 'utf-8')
    return parseYaml(yamlText) as CatalogType | null
  } catch {
    return null
  }
}

async function loadAllTypes(): Promise<CatalogType[]> {
  const fs = await import('fs/promises')
  const dir = new URL('../catalog/types/', import.meta.url)
  const files = await fs.readdir(dir)
  const types: CatalogType[] = []
  for (const file of files) {
    if (!file.endsWith('.yaml')) continue
    const yamlText = await fs.readFile(new URL(file, dir), 'utf-8')
    const parsed = parseYaml(yamlText) as CatalogType | null
    if (parsed) types.push(parsed)
  }
  return types
}

export async function matchColumnToType(column: ColumnInfo, tier: 'vibe' | 'prototype' | 'production' = 'production'): Promise<TypeMatchResult | null> {
  const types = await loadAllTypes()

  const scored: Array<{ type: CatalogType; score: number }> = []

  for (const type of types) {
    let score = scoreType(type, column)

    if (score > 0 && type.match?.maxLength != null && type.match.maxLength > 0 && column.maxLength != null) {
      if (column.maxLength <= type.match.maxLength) {
        score += 5
      }
    }

    if (score > 0) {
      scored.push({ type, score })
    }
  }

  if (scored.length === 0) {
    const textType = types.find(t => t.name === 'text')
    if (textType) return { type: textType, confidence: 0 }
    return null
  }

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]!
  const maxPossible = Math.max(...scored.map(s => s.score))
  const confidence = maxPossible > 0 ? best.score / maxPossible : 0

  return { type: best.type, confidence }
}

/**
 * Does a catalog `data_type` claim fit this column?
 *
 * Catalog rules are written against SQL types as a person writes them
 * (`varchar(15)`, `date`, `text`), while introspection reports
 * `dataType: 'varchar'` plus a separate `maxLength`. Comparing the two
 * literally meant a rule like `us-phone`'s never fired on a real column.
 * `varchar(N)` is read as "fits N characters", which is how the catalog uses it
 * (`us-phone` lists both 15 and 20).
 */
function matchesDataType(claim: string, info: ColumnInfo): boolean {
  const spec = claim.trim().toLowerCase().replace(/\s+/g, ' ')
  // An unknown data type (a bare column name was passed) cannot disqualify a
  // rule — the caller simply does not have that information.
  if (info.dataType === '') return true

  const varcharLength = /^varchar\s*\(\s*(\d+)\s*\)$/.exec(spec)
  if (varcharLength) {
    const limit = Number(varcharLength[1])
    if (info.dataType.toLowerCase() !== 'varchar') return false
    return info.maxLength == null || info.maxLength <= limit
  }

  return info.dataType.toLowerCase() === spec
}

/**
 * Score one catalog type against a column.
 *
 * A rule branch that names a `data_type` must satisfy it: a name match alone is
 * not enough. That is what kept `date-us` (MM/DD/YYYY text) attached to
 * `TIMESTAMPTZ` columns whose name happens to contain "date", and it is why a
 * phone column of any width used to claim the narrow US-phone rule.
 */
function scoreType(type: CatalogType, info: ColumnInfo): number {
  if (!type.match?.sql) return 0

  let score = 0
  for (const rawPattern of type.match.sql.split(/\bOR\b/)) {
    const pattern = rawPattern.trim()
    if (!pattern) continue

    const likeMatch = /LIKE\s+'%([^']+)%'/i.exec(pattern)
    // One level of nesting: `IN ('varchar(20)', 'varchar(15)')` — a plain
    // `[^)]+` stops at the `)` inside the first type name.
    const inMatch = /data_type\s+IN\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/i.exec(pattern)
    const eqMatch = /data_type\s*=\s*'([^']+)'/i.exec(pattern)

    const claimsType = inMatch !== null || eqMatch !== null
    if (!likeMatch && !claimsType) continue

    // A bare column name carries no data type. A type-only branch cannot be
    // confirmed, so it must not fire; a branch that also names the column can
    // still match on the name alone.
    if (claimsType && info.dataType === '' && !likeMatch) continue

    const typeOk = inMatch
      ? inMatch[1]!.split(',').map((s) => s.trim().replace(/'/g, '')).some((t) => matchesDataType(t, info))
      : eqMatch
        ? matchesDataType(eqMatch[1]!, info)
        : true
    if (!typeOk) continue

    if (likeMatch) {
      const keyword = likeMatch[1]!.toLowerCase()
      if (!info.columnName.toLowerCase().includes(keyword)) continue
      score += keyword.length * 3
    }
    if (claimsType) score += 3
  }
  return score
}

export function loadAllTypesSync(): CatalogType[] {
  const dir = new URL('../catalog/types/', import.meta.url)
  const files = readdirSync(dir)
  const types: CatalogType[] = []
  for (const file of files) {
    if (!file.endsWith('.yaml')) continue
    const yamlText = readFileSync(new URL(file, dir), 'utf-8')
    const parsed = parseYaml(yamlText) as CatalogType | null
    if (parsed) types.push(parsed)
  }
  return types
}

/**
 * Find the catalog type that best describes a column.
 *
 * `column` accepts a bare name as a convenience, because "which type is this
 * column?" is the whole question this answers and passing a string is the
 * obvious thing to try. A string carries no data type, so it is matched on name
 * alone — if the catalog has a rule keyed on `data_type` and the caller's column
 * name does not identify a type on its own, the answer is `null` rather than a
 * guess. Pass a `ColumnInfo` when you have one.
 *
 * Throws a named error rather than failing inside the matcher: a `TypeError` on
 * `column.columnName` told an agent nothing about what was expected.
 */
export function matchColumnToTypeSync(
  column: ColumnInfo | string,
  types: CatalogType[],
  tier: 'vibe' | 'prototype' | 'production' = 'production',
): TypeMatchResult | null {
  let info: ColumnInfo =
    typeof column === 'string'
      ? {
          columnName: column,
          // No data type is available from a bare name, and an empty one is how
          // the data_type rules below are told to stand down.
          dataType: '',
          isNullable: true,
          maxLength: null,
          defaultValue: null,
          isPrimaryKey: false,
          foreignKey: null,
        }
      : column

  if (!info || typeof info.columnName !== 'string' || info.columnName === '') {
    throw new TypeError(
      'matchColumnToTypeSync needs a column: a name, or a ColumnInfo from the schema. ' +
        'Take it from the schema rather than building one: ' +
        "schema.tables[0].columns.find(c => c.columnName === 'email').",
    )
  }

  // A partial ColumnInfo is a plausible thing to construct by hand, and the
  // rules below read dataType and maxLength without checking. Fill the gaps
  // rather than failing on `undefined.toLowerCase()` deep in a scoring loop.
  if (typeof info.dataType !== 'string') info = { ...info, dataType: '' }

  const scored: Array<{ type: CatalogType; score: number }> = []

  for (const type of types) {
    let score = scoreType(type, info)

    // The maxLength rule only breaks ties between types that already matched on
    // name or data type. Awarding it on its own let any type claim any column
    // short enough to fit: `plan VARCHAR(40)` matched `email` (maxLength 254)
    // even though email's rule requires an email-ish name, and five types tied
    // on that bonus so the winner depended on array order.
    if (score > 0 && type.match?.maxLength != null && type.match.maxLength > 0 && info.maxLength != null) {
      if (info.maxLength <= type.match.maxLength) {
        score += 5
      }
    }

    if (score > 0) {
      scored.push({ type, score })
    }
  }

  if (scored.length === 0) {
    const textType = types.find(t => t.name === 'text')
    if (textType) return { type: textType, confidence: 0 }
    return null
  }

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]!
  const maxPossible = Math.max(...scored.map(s => s.score))
  const confidence = maxPossible > 0 ? best.score / maxPossible : 0

  return { type: best.type, confidence }
}