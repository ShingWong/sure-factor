// sure-factor — Catalog-aware code generation from database schemas
//
// Architecture:
//   catalog/types/       — Data type definitions (email, zip5, icd10, ...)
//   catalog/components/  — UI component templates (form, data-table, ...)
//   catalog/assets/      — Static assets (i18n, audio, themes, lookup data)
//   src/                 — Generator engine (introspect → match → generate)
//
// Public API
export { introspectSchema } from './introspect.js'
export type { ColumnInfo, TableInfo, SchemaInfo } from './introspect.js'

export { matchColumnToType, matchColumnToTypeSync, loadAllTypesSync, type TypeMatchResult } from './match.js'

export { generateForTier, type GenerationTier, type GenerateOptions } from './generate.js'
export { generateStore, type StoreGenerationOptions, type GeneratedStoreOutput, type SyncDirection } from './generate-store.js'
export { sanitize, sanitizeInput, sanitizeOutput } from './sanitize.js'
export { toYaml, toJson, fromJson, toMarkdown, toXml, fromXml, convert } from './serialize.js'
export { formatCode, formatGeneratedOutput, formatGeneratedStoreOutput } from './format.js'
export type { FormattedOutput, FormattedStoreOutput } from './format.js'
export type { CatalogType, CatalogComponent, CatalogAsset } from './types.js'