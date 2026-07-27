function parseInlineArray(val: string): unknown[] {
  const inner = val.slice(1, -1).trim()
  if (!inner) return []
  return inner.split(',').map(s => parseYamlValue(s.trim()))
}

function parseInlineObject(val: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  val.slice(1, -1).split(',').forEach(pair => {
    const colonIdx = pair.indexOf(':')
    if (colonIdx === -1) return
    const k = pair.slice(0, colonIdx).trim()
    const v = pair.slice(colonIdx + 1).trim()
    if (k) obj[k] = parseYamlValue(v)
  })
  return obj
}

function unquoteYamlString(val: string): string | null {
  if (val.length < 2) return null
  if (val[0] === "'" && val[val.length - 1] === "'") {
    return val.slice(1, -1).replace(/''/g, "'")
  }
  if (val[0] === '"' && val[val.length - 1] === '"') {
    return val.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  return null
}

function parseYamlValue(val: string): unknown {
  if (val === 'null' || val === '~') return null
  if (val === 'true') return true
  if (val === 'false') return false
  const unquoted = unquoteYamlString(val)
  if (unquoted !== null) return unquoted
  if (val.startsWith('[') && val.endsWith(']')) return parseInlineArray(val)
  if (val.startsWith('{') && val.endsWith('}')) return parseInlineObject(val)
  const num = Number(val)
  if (!Number.isNaN(num) && val !== '' && val.trim() === val) return num
  return val
}

function isNextLineArray(lines: string[], currentIdx: number, baseIndent: number): boolean {
  for (let i = currentIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = lines[i]!.length - lines[i]!.trimStart().length
    if (indent <= baseIndent) return false
    return trimmed.startsWith('- ')
  }
  return false
}

export function parseYaml(text: string): Record<string, unknown> | null {
  try {
    const root: Record<string, unknown> = {}
    const lines = text.split('\n')
    const path: Array<{ indent: number; obj: Record<string, unknown> }> = [
      { indent: -1, obj: root },
    ]
    let arrayTarget: { obj: Record<string, unknown>; key: string } | null = null
    let arrayIndent = -1

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const indent = lines[i]!.length - lines[i]!.trimStart().length

      if (!trimmed.startsWith('- ')) {
        arrayTarget = null
      }

      while (path.length > 1 && path[path.length - 1]!.indent >= indent) {
        path.pop()
      }

      const current = path[path.length - 1]!

      if (trimmed.startsWith('- ')) {
        const itemRaw = trimmed.slice(2).trim()
        const itemColon = itemRaw.indexOf(':')
        if (itemColon !== -1 && itemColon < itemRaw.length - 1 && itemRaw[itemColon + 1] === ' ') {
          const itemKey = itemRaw.slice(0, itemColon).trim()
          const itemVal = itemRaw.slice(itemColon + 1).trim()
          const itemObj: Record<string, unknown> = { [itemKey]: parseYamlValue(itemVal) }
          if (arrayTarget) {
            ;(arrayTarget.obj[arrayTarget.key] as unknown[]).push(itemObj)
          }
          path.push({ indent, obj: itemObj })
          arrayTarget = null
        } else {
          if (arrayTarget) {
            ;(arrayTarget.obj[arrayTarget.key] as unknown[]).push(parseYamlValue(itemRaw))
          }
        }
        continue
      }

      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) continue

      const key = trimmed.slice(0, colonIdx).trim()
      const val = trimmed.slice(colonIdx + 1).trim()

      if (val === '|' || val === '>') {
        // Block scalar: collect indented lines below
        const blockLines: string[] = []
        const blockIndent = indent + 1
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j]!
          if (line.trim() === '' || line.startsWith('#')) continue
          const lineIndent = line.length - line.trimStart().length
          if (lineIndent < blockIndent) break
          blockLines.push(line.trimStart())
          i = j
        }
        current.obj[key] = val === '>' ? blockLines.join(' ') : blockLines.join('\n')
        continue
      }

      if (val === '') {
        if (isNextLineArray(lines, i, indent)) {
          current.obj[key] = []
          arrayTarget = { obj: current.obj, key }
        } else {
          const nested: Record<string, unknown> = {}
          current.obj[key] = nested
          path.push({ indent, obj: nested })
        }
      } else {
        current.obj[key] = parseYamlValue(val)
      }
    }

    return root
  } catch {
    return null
  }
}
