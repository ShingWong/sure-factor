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

/** Bindings whose dotted leaves are projection names (e.g. `rows.amount`). */
const ROW_BINDINGS = new Set(['rows', 'row', 'record', 'data', 'series', 'item', 'fields', 'input'])

/** Words that are operators, builtins or computed namespaces, not projections. */
const NON_PROJECTIONS = new Set([
  'true', 'false', 'null', 'undefined', 'and', 'or', 'not', 'in',
  'sum', 'sub', 'ifpresent', 'min', 'max', 'count', 'abs', 'round', 'len',
  'totals', 'F', 'P',
])

/** True when an entry opts into the document-part extension. */
export function isDocumentPart(component: Partial<CatalogComponent>): boolean {
  return component.family !== undefined
    || component.data !== undefined
    || component.print !== undefined
    || component.guards !== undefined
    || component.fixture !== undefined
}

/**
 * Extract every projection name a guard expression references.
 *
 * Three reference forms are understood (the closed vocabulary of
 * sure-document `design §5`, plus the dotted form used in `docs/catalog.md`):
 *
 *  - `F:name`          — field of the current row (design §5)
 *  - `rows.name`       — dotted access under a row binding, incl. `record`,
 *                        `data`, `series`
 *  - `name`            — a bare identifier used as a value
 *
 * `P:name` names a parameter, not a projection, and is ignored; so are
 * function names, keywords and computed namespaces such as `totals`. This is
 * a scanner, not an evaluator — no dynamic code execution of guard strings.
 */
function projectionRefs(expr: string): string[] {
  const refs = new Set<string>()

  for (const m of expr.matchAll(/\bF:([A-Za-z_]\w*)/g)) refs.add(m[1]!)

  const params = [...expr.matchAll(/\bP:([A-Za-z_]\w*)/g)].map((m) => m[1]!)

  for (const m of expr.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)) {
    if (ROW_BINDINGS.has(m[1]!)) refs.add(m[2]!)
  }

  for (const m of expr.matchAll(/\b([A-Za-z_]\w*)\b(?!\s*\()/g)) {
    const id = m[1]!
    if (NON_PROJECTIONS.has(id) || params.includes(id)) continue
    // A dotted leaf was already captured above; a dotted *root* is a binding.
    if (new RegExp(`\\.${id}\\b`).test(expr)) continue
    if (new RegExp(`\\b${id}\\s*\\.`).test(expr)) continue
    refs.add(id)
  }

  return [...refs]
}

export interface DocumentPartIssue {
  /** Short machine-readable reason. */
  code: 'BAD_FAMILY' | 'BAD_SHAPE' | 'GUARD_WITHOUT_PROJECTION' | 'UNKNOWN_PROJECTION' | 'BAD_FIXTURE'
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
  if (guards.length > 0 && projection.length === 0) {
    issues.push({
      code: 'GUARD_WITHOUT_PROJECTION',
      message: `${label}: declares guards but no data.projection to check them against`,
    })
  }
  for (const guard of guards) {
    for (const ref of projectionRefs(guard)) {
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
