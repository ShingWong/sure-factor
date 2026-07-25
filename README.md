# sure-factor

**Database schema → production-grade UI components.** A code generation framework that transforms SQL schemas into validated, sanitized, internationalized, accessible form UIs.

## Architecture

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│introspect│───▶│  match   │───▶│ generate │
│  DDL →   │    │column→type│   │ tiered   │
│ SchemaInfo│   │ TypeMatch │   │  output  │
└──────────┘    └──────────┘    └──────────┘
```

**Three phases:**
1. **Introspect** — Parse DDL or query `information_schema` → `SchemaInfo` (tables, columns, types, constraints)
2. **Match** — Match each column to catalog type definitions using name patterns + data type rules → `TypeMatchResult` with confidence scoring
3. **Generate** — Produce tier-aware output: routes, templates, i18n, sanitization pipeline, validation rules, theme CSS, and sure-state stores

## Quick Start

```ts
import { introspectSchemaFromDdl } from 'sure-factor/introspect'
import { loadAllTypesSync, matchColumnToTypeSync } from 'sure-factor'
import { generateForTier } from 'sure-factor/generate'
import { generateStore } from 'sure-factor/generate-store'
import { sanitize } from 'sure-factor/sanitize'
import { convert } from 'sure-factor/serialize'

// 1. Introspect
const schema = introspectSchemaFromDdl(`
  CREATE TABLE patients (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    diagnosis VARCHAR(8),
    zip VARCHAR(5)
  );
`)

// 2. Match
const allTypes = loadAllTypesSync()
const emailCol = schema.tables[0]!.columns.find(c => c.columnName === 'email')!
const result = matchColumnToTypeSync(emailCol, allTypes)
// → { type: { name: 'email', ... }, confidence: 1 }

// 3. Generate UI
const output = generateForTier(schema, { tier: 'production', component: 'form' })
// → { routes, template, i18n, styles, scripts, validation, sanitization }

// 4. Generate store
const store = generateStore({
  tableName: 'patients',
  columns: schema.tables[0]!.columns,
  tier: 'production',
})
// → { interfaceCode, apiCode, storeCode, fullCode }

// 5. Sanitize input
sanitize('  user@Example.COM  ', ['trim', 'lowercase', 'normalize(NFKC)'])
// → 'user@example.com'
```

## Catalog

Types and components are defined as YAML in `catalog/`:

```
catalog/
  types/          ← 15 type definitions (email, zip5, icd10, ssn, ...)
  components/     ← 5 component templates (form, form-modal, data-table, crud-resource, search-filter)
  assets/         ← i18n JSON, audio scripts, lookup datasets, theme CSS
```

### Type Definition

```yaml
name: zip5
description: 5-digit US ZIP code
match:
  sql: column_name LIKE '%zip%' OR column_name LIKE '%postal%'
  regex: ^\d{5}$
  maxLength: 5
validation:
  regex: ^\d{5}$
  maxLength: 5
sanitize:
  input: [trim, stripNonDigits, normalize(NFKC), slice(0, 5)]
  output: [htmlEscape]
hints:
  en: { placeholder: '90210', help: 5-digit US ZIP code, error: { format: 'Must be 5 digits', required: Required } }
tiers:
  vibe:      { validation: { regex: ^\d{5}$ }, sanitize: [trim, htmlEscape] }
  prototype: { validation: { regex: ^\d{5}$, maxLength: 5 }, sanitize: [trim, stripNonDigits, normalize(NFKC), slice(0,5)] }
  production:{ validation: { regex: ^\d{5}$, maxLength: 5, lookup: us-zip-codes.json }, sanitize: [trim, stripNonDigits, normalize(NFKC), slice(0,5)] }
security:
  encrypt: false
```

## Public API

| Import path | Exports |
|-------------|---------|
| `sure-factor` | `introspectSchema`, `matchColumnToType`, `generateForTier`, `generateStore`, `sanitize`, `sanitizeInput`, `sanitizeOutput`, `convert`, `toYaml`, `toJson`, `fromJson`, `toMarkdown`, `toXml`, `fromXml` |
| `sure-factor/introspect` | `introspectSchema`, `introspectSchemaFromDdl`, types |
| `sure-factor/generate` | `generateForTier`, `GenerationTier` |
| `sure-factor/generate-store` | `generateStore` |
| `sure-factor/sanitize` | `sanitize`, `sanitizeInput`, `sanitizeOutput` + individual step functions |
| `sure-factor/serialize` | `convert`, `toYaml`, `toJson`, `toMarkdown`, `toXml`, `fromXml` |

## Tiers

| Feature | Vibe | Prototype | Production |
|---------|------|-----------|------------|
| Validation | Basic regex | Type + regex + DB constraints | Full + lookup datasets |
| Sanitization | Trim + escape | Full input pipeline | + DOMPurify for rich text |
| i18n | English | 2-3 languages | Full catalog |
| Notifications | Inline | Inline + toast + statusBar | All modes |
| Audio | None | Error bell | Chime + speech |
| Security | Param queries | + CSRF | + Encryption + audit |
| State sync | — | — | sure-state + versioning |

## Serialization

```ts
import { convert } from 'sure-factor/serialize'

// YAML ↔ JSON ↔ XML ↔ Markdown
convert(yamlString, 'yaml', 'json')   // → JSON string
convert(jsonString, 'json', 'yaml')   // → YAML string
convert(yamlString, 'yaml', 'xml')    // → XML string
convert(xmlString, 'xml', 'md')       // → Markdown string
```

## Related Projects

| Project | Role | Location |
|---------|------|----------|
| **sure-state** | Client-server state sync (Zustand + WebSocket) | `/usr/local/devel/sure-state` |
| **sure-ui** | Theme CSS + notification runtime | `/usr/local/devel/sure-ui` |
| **sure-master** | Planning, PRDs, specs | `/usr/local/devel/sure-master` |

## Development

```bash
# Build
npm run build

# Test (8 test files, 117 tests)
npm test

# Lint
npm run lint
```
