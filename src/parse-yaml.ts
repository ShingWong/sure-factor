/**
 * Split a flow collection's body on `sep` at nesting depth zero.
 *
 * Two things a plain `split(',')` gets wrong:
 *  - a quoted or bracketed value may contain the separator, so scan with a
 *    depth/quote tracker rather than splitting blindly;
 *  - inside a flow *mapping* (`{ key: value, ... }`) a value that is not
 *    quoted may itself contain the separator — a regex quantifier such as
 *    `{0,61}`, or a character class holding a `/`. YAML has no way to
 *    disambiguate that from a real pair, so a separator is only treated as
 *    structural when what follows looks like the next `key:` of this mapping.
 */
function splitFlowEntries(body: string, sep: string = ',', isMapping = false): string[] {
  const parts: string[] = []
  let depth = 0
  let parenDepth = 0
  let quote: string | null = null
  let inCharClass = false
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < body.length) {
        current += ch + body[i + 1]!
        i++
        continue
      }
      if (ch === quote) {
        if (quote === "'" && body[i + 1] === "'") {
          current += "''"
          i++
          continue
        }
        quote = null
      }
      current += ch
      continue
    }
    // A quote only opens a quoted scalar at the START of a value. Mid-scalar
    // it is ordinary content — a regex character class such as `[!#$%&'*+/]`
    // contains an apostrophe that would otherwise swallow the rest of the line.
    if ((ch === "'" || ch === '"') && current.trim() === '') {
      quote = ch
      current += ch
      continue
    }
    // A regex character class may contain any bracket, brace or separator —
    // `[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]` — so nothing inside it is structural.
    if (ch === '[' && !inCharClass) {
      inCharClass = true
      current += ch
      continue
    }
    if (inCharClass) {
      if (ch === '\\') {
        current += ch + (body[i + 1] ?? '')
        i++
        continue
      }
      if (ch === ']') inCharClass = false
      current += ch
      continue
    }
    if (ch === '[' || ch === '{') {
      depth++
      current += ch
      continue
    }
    if (ch === ']' || ch === '}') {
      if (depth > 0) depth--
      current += ch
      continue
    }
    // A function-call argument list may itself contain the separator, as in the
    // sanitisation step `slice(0, maxLength)`. Track it so the call is kept
    // whole.
    if (ch === '(') {
      parenDepth++
      current += ch
      continue
    }
    if (ch === ')') {
      if (parenDepth > 0) parenDepth--
      current += ch
      continue
    }
    if (ch === sep && depth === 0 && parenDepth === 0) {
      // In a mapping, only split when the next non-space run is a bare key
      // followed by `:`. `{0,61}` and `[a,b]` do not match, so they stay whole.
      // In an array every top-level comma is structural.
      if (isMapping) {
        const rest = body.slice(i + 1)
        const looksLikeNextPair = /^\s*[A-Za-z_][\w.-]*\s*:(\s|$)/.test(rest)
        if (!looksLikeNextPair) {
          current += ch
          continue
        }
      }
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

function parseInlineArray(val: string): unknown[] {
  const inner = val.slice(1, -1).trim()
  if (!inner) return []
  return splitFlowEntries(inner).map(s => parseYamlValue(s.trim()))
}

function parseInlineObject(val: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const pair of splitFlowEntries(val.slice(1, -1), ',', true)) {
    const colonIdx = pair.indexOf(':')
    if (colonIdx === -1) continue
    const k = pair.slice(0, colonIdx).trim()
    const v = pair.slice(colonIdx + 1).trim()
    if (k) obj[k] = parseYamlValue(v)
  }
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
    // Stack of open block arrays. `indent` is the indentation shared by that
    // array's `- ` items, or -1 until the first item is seen. A stack (rather
    // than a single target) lets a block array nested inside an array item
    // hand control back to the outer array when it ends.
    const arrays: Array<{ obj: Record<string, unknown>; key: string; indent: number }> = []

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const indent = lines[i]!.length - lines[i]!.trimStart().length
      const isItem = trimmed.startsWith('- ')

      // Leave every block array whose items sit deeper than this line. This
      // runs for `- ` items too, so an item at the outer indent closes a
      // deeper nested array first.
      while (arrays.length > 0) {
        const open = arrays[arrays.length - 1]!
        if (open.indent >= 0 && indent < open.indent) arrays.pop()
        else break
      }

      while (path.length > 1 && path[path.length - 1]!.indent >= indent) {
        path.pop()
      }

      const current = path[path.length - 1]!

      if (isItem) {
        const open = arrays[arrays.length - 1]
        if (open && open.indent === -1) open.indent = indent
        // Only an item sharing the array's own indent belongs to it; deeper
        // items belong to an array nested inside the current item.
        const target = open && open.indent === indent ? open : undefined

        const itemRaw = trimmed.slice(2).trim()
        const itemColon = itemRaw.indexOf(':')
        if (itemColon !== -1 && itemColon < itemRaw.length - 1 && itemRaw[itemColon + 1] === ' ') {
          const itemKey = itemRaw.slice(0, itemColon).trim()
          const itemVal = itemRaw.slice(itemColon + 1).trim()
          const itemObj: Record<string, unknown> = { [itemKey]: parseYamlValue(itemVal) }
          if (target) {
            ;(target.obj[target.key] as unknown[]).push(itemObj)
          }
          path.push({ indent, obj: itemObj })
        } else {
          if (target) {
            ;(target.obj[target.key] as unknown[]).push(parseYamlValue(itemRaw))
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
          arrays.push({ obj: current.obj, key, indent: -1 })
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
