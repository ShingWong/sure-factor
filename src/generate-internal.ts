/**
 * Helpers shared by the server target (`generate.ts`) and the client target
 * (`generate-client.ts`). They live here rather than in either generator so the
 * two can use them without a circular import — and so both emit the same
 * escaping and the same collision handling, which is what keeps the two
 * targets agreeing about a column's key and its regex.
 */

/**
 * A stable key for a column. The bare column name is used when it is unique
 * across the schema, so simple single-table output is unchanged; a repeat is
 * qualified by its table so no entry is overwritten.
 */
export function uniqueKey(seen: Map<string, string[]>, table: string, column: string): string {
  const taken = new Set(seen.keys())
  if (!taken.has(column)) {
    const count = countColumns(seen, column)
    if (count === 0) return column
    return `${table}_${column}`
  }
  return `${table}_${column}`
}

function countColumns(seen: Map<string, string[]>, column: string): number {
  let n = 0
  for (const k of seen.keys()) {
    if (k === column || k.endsWith(`_${column}`)) n++
  }
  return n
}

/**
 * Embed a regex as a `/.../` literal. Escaping `/` alone truncates any
 * character class that contains one (`[a-z0-9.!#$%&'*+/=?]`) and any
 * quantifier brace; `RegExp.prototype.source` already produces a
 * correctly-escaped body.
 */
export function toRegexLiteral(pattern: string): string {
  return `/${new RegExp(pattern).source}/`
}

/**
 * Render one catalog sanitisation step as a single string. Steps are either a
 * bare name (`trim`, `slice(0, 254)`) or a parameterised object
 * (`{ normalize: NFKC }`). Both become one argument: the `slice(0, 254)` form
 * carries a comma inside its argument and must not be split in two.
 */
export function sanitizeStepLiteral(step: unknown): string {
  if (typeof step === 'string') return JSON.stringify(step)
  if (step && typeof step === 'object' && !Array.isArray(step)) {
    const [name, arg] = Object.entries(step as Record<string, unknown>)[0] ?? []
    if (name) return JSON.stringify(`${name}: ${String(arg ?? '')}`)
  }
  return JSON.stringify(String(step))
}

/**
 * Flatten a catalog type's `sanitize.input` into the `string[]` that
 * `sanitize()` takes.
 *
 * A bare step stays as it is (`trim`, `slice(0, 254)` — note the comma inside
 * the parentheses, which must survive intact). A parameterised step written as
 * a YAML mapping (`- normalize: NFKC`) parses to an object and becomes the
 * call form `normalize(NFKC)`.
 *
 * An empty or absent list still yields `['trim']`, so a form always returns
 * something rather than passing raw input through.
 */
export function sanitizeStepList(input: unknown): string[] {
  if (!Array.isArray(input)) return ['trim']
  const steps = input.map((step) => {
    if (typeof step === 'string') return step.trim() === '' ? null : step
    if (step && typeof step === 'object' && !Array.isArray(step)) {
      const [name, arg] = Object.entries(step as Record<string, unknown>)[0] ?? []
      if (typeof name !== 'string' || name === '' || arg == null) return null
      return `${name}(${String(arg)})`
    }
    return null
  }).filter((s): s is string => s !== null)
  return steps.length > 0 ? steps : ['trim']
}

/**
 * Render a Map of key → chained calls as the body of a JavaScript object
 * literal, with every entry comma-separated so the result parses.
 */
export function objectBody(entries: Map<string, string[]>, wrap = 'z.string()'): string {
  return [...entries.entries()]
    .map(([key, chain]) => `  ${JSON.stringify(key)}: ${wrap}${chain.join('')},`)
    .join('\n')
}