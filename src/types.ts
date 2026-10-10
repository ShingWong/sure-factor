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
}

export interface CatalogAsset {
  name: string
  type: 'audio' | 'i18n' | 'data'
  path: string
}