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
    let score = 0

    if (!type.match?.sql) continue
    const patterns = type.match.sql.split('OR').map(s => s.trim())

    let hasPatternMatch = false
    for (const pattern of patterns) {
      const likeMatch = pattern.match(/LIKE\s+'%([^']+)%'/i)
      if (likeMatch) {
        const keyword = likeMatch[1]!.toLowerCase()
        if (column.columnName.toLowerCase().includes(keyword)) {
          score += keyword.length * 3
          hasPatternMatch = true
        }
      }

      const typeMatch = pattern.match(/data_type\s+IN\s+\(([^)]+)\)/i)
      if (typeMatch && !hasPatternMatch) {
        const types = typeMatch[1]!.split(',').map(s => s.trim().replace(/'/g, '').toLowerCase())
        if (types.includes(column.dataType.toLowerCase())) {
          score += 3
          hasPatternMatch = true
        }
      }
    }

    if (!hasPatternMatch) continue

    if (type.match?.maxLength != null && type.match.maxLength > 0 && column.maxLength != null) {
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
    let score = 0

    if (!type.match?.sql) continue
    const patterns = type.match.sql.split('OR').map(s => s.trim())

    for (const pattern of patterns) {
      const likeMatch = pattern.match(/LIKE\s+'%([^']+)%'/i)
      if (likeMatch) {
        const keyword = likeMatch[1]!.toLowerCase()
        if (info.columnName.toLowerCase().includes(keyword)) {
          score += keyword.length * 3
        }
      }

      const typeMatch = pattern.match(/data_type\s+IN\s+\(([^)]+)\)/i)
      if (typeMatch && !likeMatch) {
        const matchedTypes = typeMatch[1]!.split(',').map(s => s.trim().replace(/'/g, '').toLowerCase())
        // A bare string carries no data type, so a data_type rule must not fire
        // on it — otherwise every type with such a rule would match whatever
        // name the caller passed.
        if (info.dataType !== '' && matchedTypes.includes(info.dataType.toLowerCase())) {
          score += 3
        }
      }
    }

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