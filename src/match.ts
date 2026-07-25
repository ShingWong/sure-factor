import { readdirSync, readFileSync } from 'fs'
import type { ColumnInfo } from './introspect'
import type { CatalogType } from './types'
import { parseYaml } from './parse-yaml'

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

export function matchColumnToTypeSync(column: ColumnInfo, types: CatalogType[], tier: 'vibe' | 'prototype' | 'production' = 'production'): TypeMatchResult | null {
  const scored: Array<{ type: CatalogType; score: number }> = []

  for (const type of types) {
    let score = 0

    if (!type.match?.sql) continue
    const patterns = type.match.sql.split('OR').map(s => s.trim())

    for (const pattern of patterns) {
      const likeMatch = pattern.match(/LIKE\s+'%([^']+)%'/i)
      if (likeMatch) {
        const keyword = likeMatch[1]!.toLowerCase()
        if (column.columnName.toLowerCase().includes(keyword)) {
          score += keyword.length * 3
        }
      }

      const typeMatch = pattern.match(/data_type\s+IN\s+\(([^)]+)\)/i)
      if (typeMatch && !likeMatch) {
        const matchedTypes = typeMatch[1]!.split(',').map(s => s.trim().replace(/'/g, '').toLowerCase())
        if (matchedTypes.includes(column.dataType.toLowerCase())) {
          score += 3
        }
      }
    }

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