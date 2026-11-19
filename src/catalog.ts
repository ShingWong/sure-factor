/**
 * Catalog schema extension — document parts (0.6).
 *
 * A catalog entry may describe a document part (a report) instead of a form.
 * The five extension keys (`family`, `data`, `print`, `guards`, `fixture`) are
 * pure data: this module only checks their shape and, critically, checks that
 * a guard does not reference a projection the entry never declared.
 *
 * No sure-ui styles are composed here. Report parts declare the `document`
 * and `figure` blocks, which sure-ui publishes from 0.3.6; the registry test
 * checks those declarations against the installed `COMPONENTS` via
 * `unpublishedBlocks`. The generated report module carries the contract
 * (layout data, guards, classes) and leaves runtime rendering to sure-document.
 */
import type {
  CatalogComponent,
  ComponentDataShape,
  ComponentFamily,
} from './types.js'

/** The closed set of document-part families. */
export const COMPONENT_FAMILIES: readonly ComponentFamily[] = ['structure', 'data', 'figure'] as const

/**
 * Declared `sure_ui` blocks that the installed sure-ui does not publish.
 *
 * `knownBlocks` is supplied by the caller — normally sure-ui's `COMPONENTS`
 * export — so this module stays dependency-free and never evaluates strings:
 * it is a plain membership test over the closed `sure_ui` declaration. An empty
 * result means every declared block has shipped styles; a non-empty result
 * names each offending component (`name: block`) so the registry test fails
 * loudly. No dynamic code execution of the declarations is involved.
 */
export function unpublishedBlocks(
  component: Pick<CatalogComponent, 'name' | 'sure_ui'>,
  knownBlocks: ReadonlySet<string>,
): string[] {
  const label = component.name || 'unnamed component'
  return (component.sure_ui ?? [])
    .filter((block) => !knownBlocks.has(block))
    .map((block) => `${label}: ${block}`)
}

const DATA_SHAPES: readonly ComponentDataShape[] = ['record', 'rows', 'series', 'none', 'derived'] as const

/** Bindings whose dotted leaves are row/record projections. */
const ROW_BINDINGS = new Set(['rows', 'row', 'record', 'data', 'series', 'item', 'fields', 'input'])

/** The canonical aggregates of the strict grammar. `count` is a tolerated
 *  legacy alias kept so the published sure-store entries still validate; it is
 *  not one of the canonical five. */
const AGGREGATES = new Set(['sum', 'sub', 'mul', 'div', 'avg', 'count'])

/** Operators, literals and keywords that are never references. */
const NON_REFERENCES = new Set([
  'true', 'false', 'null', 'undefined', 'and', 'or', 'not', 'in',
  'ifpresent',
])

/** True when an entry opts into the document-part extension. */
export function isDocumentPart(component: Partial<CatalogComponent>): boolean {
  return component.family !== undefined
    || component.data !== undefined
    || component.print !== undefined
    || component.guards !== undefined
    || component.fixture !== undefined
}

interface ScopeError {
  token: string
  reason: 'removed' | 'bare' | 'no-row-context' | 'namespace'
}

interface GuardScan {
  /** Row/record projections a guard references — checked against data.projection. */
  projections: string[]
  /** Tokens that violate the closed scope grammar. */
  scopeErrors: ScopeError[]
}

/**
 * Scan a guard without evaluating it. The strict, closed grammar has exactly
 * these reference forms:
 *
 *  - `.field` / `row.field` / `rows.field` — row scope (needs an active row context)
 *  - `record.field` (and the legacy `data`/`series`/… bindings) — the current record
 *  - `@field` / `root.field`               — root (document/header) scope
 *  - `totals.field`                        — explicit root namespace for server totals
 *  - raw numeric literals, aggregates (`sum:` / `sum(...)`, …) and `ifpresent:`
 *    operators — never references
 *
 * Removed forms (`F:`, `P:`) and bare identifiers fail closed as SCOPE_INVALID,
 * matching sure-document's `E_SCOPE_INVALID`. This is a scanner, not an
 * evaluator — no dynamic code execution of guard strings.
 */
function scanGuard(expr: string, hasRowContext: boolean): GuardScan {
  const text = expr.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, (s) => ' '.repeat(s.length))
  const projections = new Set<string>()
  const scopeErrors = new Map<string, ScopeError>()
  const addError = (token: string, reason: ScopeError['reason']): void => {
    if (!scopeErrors.has(token)) scopeErrors.set(token, { token, reason })
  }

  // F: and P: are removed outright; flag them before the general scan and
  // skip their leaves when it runs.
  for (const m of text.matchAll(/\b([FP]):([A-Za-z_]\w*)/g)) {
    addError(`${m[1]}:${m[2]}`, 'removed')
  }

  for (const m of text.matchAll(/([@.]?)([A-Za-z_]\w*)(?:(\s*\.\s*)([A-Za-z_]\w*))?/g)) {
    const sigil = m[1] ?? ''
    const id = m[2]!
    const leaf = m[4]
    const idx = m.index!
    const before = text.slice(Math.max(0, idx - 2), idx)
    const after = text.slice(idx + m[0]!.length, idx + m[0]!.length + 1)

    // The leaf / sigil of an already-reported F:x or P:x form.
    if (before === 'F:' || before === 'P:') continue
    if (after === ':' && (id === 'F' || id === 'P')) continue
    // A trailing colon marks a colon-form operator (`sum:`, `ifpresent:`).
    if (after === ':' && (AGGREGATES.has(id) || id === 'ifpresent')) continue

    if (sigil === '@') continue // root scope field — a parameter, not a projection

    if (sigil === '.') {
      if (!hasRowContext) addError(`.${id}`, 'no-row-context')
      else if (leaf === undefined) projections.add(id)
      continue
    }

    if (leaf !== undefined) {
      if (id === 'root' || id === 'totals') continue // root namespaces, not projections
      if (ROW_BINDINGS.has(id)) {
        if ((id === 'row' || id === 'rows') && !hasRowContext) addError(`${id}.${leaf}`, 'no-row-context')
        else projections.add(leaf)
        continue
      }
      addError(id, 'namespace') // unknown namespace is a bare identifier prefix
      continue
    }

    // A bare, sigil-less identifier. Operators, function names and literals
    // are fine; everything else fails closed.
    if (!AGGREGATES.has(id) && !NON_REFERENCES.has(id)) addError(id, 'bare')
  }

  return { projections: [...projections], scopeErrors: [...scopeErrors.values()] }
}

function scopeErrorMessage(label: string, guard: string, err: ScopeError): string {
  const base = `${label}: guard "${guard}" uses scope-invalid token "${err.token}"`
  switch (err.reason) {
    case 'removed': return `${base}: F: and P: forms are removed; use .field/row.field, @field/root.field, or totals.field`
    case 'bare': return `${base}: a bare identifier has no scope; use .field/row.field, @field/root.field, totals.field, or a numeric literal`
    case 'no-row-context': return `${base}: row scope requires an active row context (data.shape "rows" or "series")`
    case 'namespace': return `${base}: "${err.token}" is not a declared namespace or row binding`
  }
}

export interface DocumentPartIssue {
  /** Short machine-readable reason. `SCOPE_INVALID` mirrors sure-document's E_SCOPE_INVALID. */
  code: 'BAD_FAMILY' | 'BAD_SHAPE' | 'GUARD_WITHOUT_PROJECTION' | 'UNKNOWN_PROJECTION' | 'BAD_FIXTURE' | 'SCOPE_INVALID'
  /** Human-readable, names the offending value. */
  message: string
}

/**
 * Validate the document-part keys of a catalog entry. Returns all issues;
 * an empty array means the entry is safe to generate from. Form entries (no
 * extension keys) are always valid here — the existing template contract
 * covers them.
 */
export function validateDocumentPart(component: CatalogComponent): DocumentPartIssue[] {
  if (!isDocumentPart(component)) return []
  const issues: DocumentPartIssue[] = []
  const label = component.name || 'unnamed component'

  if (component.family !== undefined && !COMPONENT_FAMILIES.includes(component.family)) {
    issues.push({
      code: 'BAD_FAMILY',
      message: `${label}: family "${component.family}" is not one of ${COMPONENT_FAMILIES.join(', ')}`,
    })
  }

  if (component.data?.shape !== undefined && !DATA_SHAPES.includes(component.data.shape)) {
    issues.push({
      code: 'BAD_SHAPE',
      message: `${label}: data.shape "${component.data.shape}" is not one of ${DATA_SHAPES.join(', ')}`,
    })
  }

  if (component.fixture !== undefined
    && (typeof component.fixture !== 'object' || component.fixture === null || Array.isArray(component.fixture))) {
    issues.push({ code: 'BAD_FIXTURE', message: `${label}: fixture must be a mapping` })
  }

  const guards = component.guards ?? []
  const projection = component.data?.projection ?? []
  const hasRowContext = component.data?.shape === 'rows' || component.data?.shape === 'series'
  if (guards.length > 0 && projection.length === 0) {
    issues.push({
      code: 'GUARD_WITHOUT_PROJECTION',
      message: `${label}: declares guards but no data.projection to check them against`,
    })
  }
  for (const guard of guards) {
    const { projections, scopeErrors } = scanGuard(guard, hasRowContext)
    for (const err of scopeErrors) {
      issues.push({ code: 'SCOPE_INVALID', message: scopeErrorMessage(label, guard, err) })
    }
    for (const ref of projections) {
      if (!projection.includes(ref)) {
        issues.push({
          code: 'UNKNOWN_PROJECTION',
          message: `${label}: guard "${guard}" references projection "${ref}" which is not declared in data.projection [${projection.join(', ')}]`,
        })
      }
    }
  }

  return issues
}

/** Throw with every issue joined — "fails loudly" for the generator/loader. */
export function assertValidDocumentPart(component: CatalogComponent): void {
  const issues = validateDocumentPart(component)
  if (issues.length > 0) {
    throw new Error(`Invalid document part: ${issues.map((i) => i.message).join('; ')}`)
  }
}

/**
 * Emit the report module for a document-part entry: the typed contract a
 * sure-document `renderReport` consumes. No markup is generated here —
 * rendering is sure-document's job and the classes are the only coupling.
 *
 * The generated `STYLE_BLOCKS` is intentionally the catalog's `sure_ui` list.
 * Every declared block is checked against the installed sure-ui `COMPONENTS`
 * by the registry test (`unpublishedBlocks`), so a document part cannot name a
 * block with no shipped styles — `document` and `figure` are published as of
 * sure-ui 0.3.6.
 */
export function generateReportModule(component: CatalogComponent): string {
  assertValidDocumentPart(component)
  if (!isDocumentPart(component)) {
    throw new Error(`${component.name}: not a document part — no extension keys declared`)
  }

  const report = {
    family: component.family ?? null,
    data: component.data ?? null,
    print: component.print ?? null,
    guards: component.guards ?? [],
    fixture: component.fixture ?? null,
  }

  return `// Generated by sure-factor from catalog/${component.name}.yaml — do not edit.
// Report part (family: ${component.family ?? 'unspecified'}). The markup is
// composed by sure-document; this module is its layout/data contract.

/** Class names from the catalog entry — the only coupling to the markup. */
export const CSS_CLASSES = ${JSON.stringify(component.cssClasses ?? {}, null, 2)} as const

/** Declared data shape and print/guard/fixture contract. */
export const REPORT = ${JSON.stringify(report, null, 2)} as const

/** Projections a guard is allowed to name. */
export const PROJECTION = ${JSON.stringify(component.data?.projection ?? [], null, 2)} as const

/** Guards to evaluate against the rendered figures at verify time. */
export const GUARDS = ${JSON.stringify(component.guards ?? [], null, 2)} as const

/** sure-ui blocks the markup needs styled. */
export const STYLE_BLOCKS = ${JSON.stringify(component.sure_ui ?? [], null, 2)} as const
`
}
