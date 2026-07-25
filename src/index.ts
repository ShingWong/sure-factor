// sure-factor — Catalog-aware code generation from database schemas
//
// Architecture:
//   catalog/types/       — Data type definitions (email, zip5, icd10, ...)
//   catalog/components/  — UI component templates (form, data-table, ...)
//   catalog/assets/      — Static assets (i18n, audio, themes, lookup data)
//   src/                 — Generator engine (introspect → match → generate)
//
// Public API
export { introspectSchema } from './introspect'
export type { ColumnInfo, TableInfo, SchemaInfo } from './introspect'

export { matchColumnToType, type TypeMatchResult } from './match'

export { generateForTier, type GenerationTier, type GenerateOptions } from './generate'
export { generateStore, type StoreGenerationOptions, type GeneratedStoreOutput, type SyncDirection } from './generate-store'
export { sanitize, sanitizeInput, sanitizeOutput } from './sanitize'
export { toYaml, toJson, fromJson, toMarkdown, toXml, fromXml, convert } from './serialize'
export { formatCode, formatGeneratedOutput, formatGeneratedStoreOutput } from './format'
export type { FormattedOutput, FormattedStoreOutput } from './format'
export type { CatalogType, CatalogComponent, CatalogAsset } from './types'