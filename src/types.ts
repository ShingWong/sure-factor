export interface TypeMatch {
  sql?: string
  regex?: string
  maxLength?: number
}

export interface TypeValidation {
  regex?: string | null
  minLength?: number
  maxLength?: number | null
  lookup?: string | null
}

export interface TypeHints {
  placeholder?: string
  help?: string
  error?: {
    format?: string
    required?: string
    tooShort?: string
    tooLong?: string
  }
}

export interface TypeTierConfig {
  validation: { regex?: string | null; maxLength?: number | null }
  sanitize: string[]
  hints: Record<string, { placeholder?: string; help?: string }>
}

export interface TypeSecurity {
  encrypt: boolean
  notes?: string[]
}

export interface CatalogType {
  name: string
  description?: string
  match?: TypeMatch
  validation?: TypeValidation
  sanitize?: {
    input?: string[]
    output?: string[]
  }
  hints?: Record<string, TypeHints>
  tiers?: Record<string, TypeTierConfig>
  security?: TypeSecurity
}

export interface ComponentField {
  name: string
  type: string
  required?: boolean
}

export interface ComponentBehavior {
  notificationModes: string[]
  audio: { errorBell: boolean; successChime: boolean }
  voiceHelp: boolean
  autoFocus?: boolean
  confirmBeforeCancel?: boolean
}

export interface CatalogComponent {
  name: string
  description?: string
  tier?: string
  parameters?: {
    fields?: ComponentField[]
    submitLabel?: Record<string, string>
    cancelLabel?: Record<string, string>
  }
  behavior?: ComponentBehavior
  scripts?: string[]
  cssClasses?: Record<string, string>
  /**
   * sure-ui component families this component's generated markup needs
   * styled (e.g. ['form', 'buttons']). `generateStyles` composes exactly
   * these blocks; the registry test guards the list against sure-ui's
   * COMPONENTS export so a class declared in `cssClasses` can never outgrow
   * the blocks shipped to style it.
   */
  sure_ui?: string[]

  // ── document-part extension (catalog schema 0.6) ──────────────────────────
  // A report entry is a document part, not a form. It still declares `form`
  // and `buttons` in `sure_ui` — the registry coverage guard checks those
  // declarations — but the server template emits document/table or figure
  // markup for it, never a `sure-form` wrapper or a submit button. These keys
  // add document semantics and are validated by `src/catalog.ts`.
  family?: ComponentFamily
  data?: ComponentData
  print?: ComponentPrint
  guards?: string[]
  fixture?: ComponentFixture
}

/** Document-part families — see sure-document `docs/catalog.md §3`. */
export type ComponentFamily = 'structure' | 'data' | 'figure'

/** The shape of the rows a document part consumes. */
export type ComponentDataShape = 'record' | 'rows' | 'series' | 'none' | 'derived'

/**
 * Where a document part gets its data from. `projection` is the closed set of
 * column names a guard may reference; a guard that names anything else fails
 * validation (`src/catalog.ts`). The catalog owns no query logic — the store
 * name and projection are declarations the host resolves.
 */
export interface ComponentData {
  entity?: string
  projection?: string[]
  shape?: ComponentDataShape
}

/**
 * Print declarations for a document part. The three booleans are the ones
 * sure-factor validates; the rest are passed through to sure-document as data
 * (paper, margins, binding, scale, …), never interpreted here.
 */
export interface ComponentPrint {
  keepTogether?: boolean
  breakBefore?: boolean
  repeatHeader?: boolean
  [key: string]: unknown
}

/** A seeded, synthetic example: input rows plus the facts the output must hold. */
export interface ComponentFixture {
  input?: Record<string, unknown>
  expect?: Record<string, unknown>
}

export interface CatalogAsset {
  name: string
  type: 'audio' | 'i18n' | 'data'
  path: string
}