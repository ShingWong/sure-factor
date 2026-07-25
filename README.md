# sure-factor

**Database schema → production-grade UI components.** A code generation framework that introspects SQL schemas, matches columns to a typed catalog, and generates validated, sanitized, internationalized form UIs at three tiers — vibe, prototype, and production.

```ts
import { introspectSchemaFromDdl } from 'sure-factor/introspect'
import { matchColumnToTypeSync, loadAllTypesSync } from 'sure-factor'
import { generateForTier } from 'sure-factor/generate'

const schema = introspectSchemaFromDdl(`CREATE TABLE patients (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  zip VARCHAR(5)
);`)

const output = generateForTier(schema, { tier: 'production', component: 'form' })
// → { routes, template, i18n, styles, validation, sanitization, ... }
```

### Why sure-factor?

| Problem | How sure-factor solves it |
|---------|--------------------------|
| **Forms are repetitive** | SQL schema → full form UI in one step. Introspect, match, generate — no hand-written forms. |
| **Validation is scattered** | Type definitions encode regex, length, and lookup validation per tier. Same validation for vibe (quick) and production (strict). |
| **Sanitization is an afterthought** | Declarative pipeline per type: `[trim, lowercase, normalize(NFKC), slice(0, 254)]`. Input and output pipelines are separate. |
| **i18n is tedious** | Type hints include English, Spanish, and French placeholders, help text, and error messages. Generated forms are multi-language from day one. |
| **Code quality varies by stage** | Three tiers: vibe (quick regex), prototype (full validation + 2-3 languages), production (lookup datasets + encryption + audit). |
| **No standard type catalog** | 15 built-in types (email, zip5, icd10, ssn, phone, url, ...) with match rules, validation, sanitization, i18n, and security policies. |

### How it compares

| | sure-factor | QuickDBD / dbdiagram | Prisma | Low-Code platforms |
|---|---|---|---|---|
| SQL schema → UI | ✅ Full pipeline | ❌ Diagram only | ⚠️ Schema only | ❌ Proprietary DSL |
| Type catalog | ✅ 15 types, YAML-defined | ❌ | ⚠️ Native types only | ❌ |
| Tiered generation | ✅ vibe / prototype / production | ❌ | ❌ | ❌ |
| i18n built-in | ✅ en/es/fr per type | ❌ | ❌ | ❌ |
| Sanitization pipeline | ✅ Declarative input + output steps | ❌ | ❌ | ❌ |
| Lookup datasets | ✅ ICD-10, ZIP codes | ❌ | ❌ | ❌ |
| Audio feedback | ✅ Error bell, success chime, voice help | ❌ | ❌ | ❌ |
| Export formats | ✅ HTML + CSS + JS + YAML + JSON + XML | ❌ | ❌ | ❌ |
| Framework | Agnostic (generates HTML/CSS/JS) | ❌ | ❌ | ❌ |
| File size | ~1 MB (catalog + engine) | N/A | ~15 MB | N/A |

## Architecture

```
                    ┌──────────┐
   DDL or SQL ─────▶│introspect│
                    │DDL→Schema│
                    └────┬─────┘
                         │ SchemaInfo
                         ▼
                    ┌──────────┐    ┌─────────────┐
                    │  match   │◀───│catalog/types │
                    │ col→type │    │15 YAML defs  │
                    └────┬─────┘    └─────────────┘
                         │ TypeMatchResult
                         ▼
                    ┌──────────┐    ┌────────────────┐
                    │ generate │◀───│catalog/components│
                    │ tiered   │    │5 templates      │
                    │ output   │    └────────────────┘
                    └────┬─────┘
                         │ routes, template, i18n, styles,
                         │ validation, sanitization, scripts
                         ▼
                    ┌──────────┐
                    │  format  │
                    │(Prettier)│
                    └──────────┘
```

**Three phases:**

1. **Introspect** — Parse DDL or query `information_schema` → `SchemaInfo` (tables, columns, types, constraints, foreign keys)
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

// 1. Introspect — parse DDL into typed schema
const schema = introspectSchemaFromDdl(`
  CREATE TABLE patients (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    diagnosis VARCHAR(8),
    zip VARCHAR(5)
  );
`)

// 2. Match — match columns to catalog types
const allTypes = loadAllTypesSync()
const emailCol = schema.tables[0]!.columns.find(c => c.columnName === 'email')!
const result = matchColumnToTypeSync(emailCol, allTypes)
// → { type: { name: 'email', confidence: 1 }, confidence: 1 }

// 3. Generate — produce tiered UI output
const output = generateForTier(schema, { tier: 'production', component: 'form' })
// → {
//     routes: "app.post('/patients', ...)",
//     template: "<form class='sure-form'>...",
//     i18n: { email_placeholder: 'user@example.com', ... },
//     styles: ".sure-form { max-width: 480px; }...",
//     validation: "z.string().regex(/^[a-zA-Z0-9.../).max(254)",
//     sanitization: "[trim, lowercase, normalize(NFKC), ...]"
//   }

// 4. Generate a sure-state store
const store = generateStore({
  tableName: 'patients',
  columns: schema.tables[0]!.columns,
  tier: 'production',
})
// → { interfaceCode, apiCode, storeCode, fullCode }

// 5. Sanitize input
sanitize('  user@Example.COM  ', ['trim', 'lowercase', 'normalize(NFKC)'])
// → 'user@example.com'

// 6. Serialize between formats
convert(yamlString, 'yaml', 'json')   // YAML → JSON
convert(jsonString, 'json', 'md')     // JSON → Markdown
```

## Type Catalog

15 built-in type definitions in `catalog/types/`:

| Type | Match patterns | Validation | Sanitization | Security |
|------|---------------|------------|--------------|----------|
| `email` | `%email%`, `%mail%` | RFC 5322 regex | trim, lowercase, normalize(NFKC) | Unicode normalization |
| `zip5` | `%zip%`, `%postal%` | `^\d{5}$` | stripNonDigits, slice(5) | — |
| `zip9` | `%zip9%`, `%zip+4%` | `^\d{5}-\d{4}$` | format to 5+4 | — |
| `ssn` | `%ssn%`, `%social%` | `^\d{3}-\d{2}-\d{4}$` | stripNonDigits, format | Encrypt at rest |
| `ein` | `%ein%` | `^\d{2}-\d{7}$` | stripNonDigits, format | Encrypt at rest |
| `full-name` | `%name%`, `%full_name%` | 2-100 chars | collapseWhitespace, title case | — |
| `icd10` | `%diagnosis%`, `%icd%`, `%code%` | `^[A-Z]\d{2}\.\d{1,2}$` | uppercase | Lookup dataset |
| `intl-phone` | `%phone%` | E.164 | stripNonDigits | — |
| `us-phone` | `%phone%` with US hint | `^\d{10}$` | format (XXX) XXX-XXXX | — |
| `us-address` | `%address%`, `%street%` | Multi-line | collapseWhitespace | — |
| `date-iso` | `%date%`, `%created%` | ISO 8601 | trim | — |
| `date-us` | `%date%` with US hint | MM/DD/YYYY | format | — |
| `password` | `%password%`, `%pwd%` | 8+ chars, complexity | N/A (hash server-side) | Bcrypt |
| `credit-card` | `%card%`, `%cc%` | Luhn check | stripNonDigits | Encrypt at rest |
| `url` | `%url%`, `%website%` | URL regex | trim, lowercase | — |

### Example type definition

```yaml
# catalog/types/email.yaml
name: email
description: Email address conforming to RFC 5322
match:
  sql: column_name LIKE '%email%' OR column_name LIKE '%mail%'
  regex: ^[^@]+@[^@]+\.[^@]+$
  maxLength: 254
validation:
  regex: ^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$
  maxLength: 254
sanitize:
  input: [trim, lowercase, normalize(NFKC), slice(0, 254)]
  output: [htmlEscape]
hints:
  en: { placeholder: 'user@example.com', help: 'Email address' }
  es: { placeholder: 'usuario@ejemplo.com', help: 'Dirección de correo' }
  fr: { placeholder: 'utilisateur@example.com', help: 'Adresse e-mail' }
tiers:
  vibe:
    validation: { regex: ^[^@]+@[^@]+\.[^@]+$ }
    sanitize: [trim, lowercase]
  prototype:
    validation: { regex: [full RFC], maxLength: 254 }
    sanitize: [trim, lowercase, normalize(NFKC), slice(254)]
    hints: { en, es }
  production:
    validation: { regex: [full RFC], maxLength: 254, lookup: null }
    sanitize: [trim, lowercase, normalize(NFKC), slice(254)]
    hints: { en, es, fr }
security:
  encrypt: false
  notes:
    - 'Normalize Unicode NFKC to prevent homoglyph attacks'
    - 'Lowercase to ensure case-insensitive matching'
```

## Component Catalog

5 component templates in `catalog/components/`:

| Component | Description | Notification Modes | CSS Classes |
|-----------|-------------|-------------------|-------------|
| `form` | Single-column create/edit form | inline, toast, statusBar, sidePanel | `.sure-form__*` |
| `form-modal` | Modal dialog form | inline, toast, statusBar | `.sure-modal__*` |
| `data-table` | Read-only data table | toast | `.sure-table__*` |
| `crud-resource` | Full CRUD with table + modal | inline, toast, statusBar, sidePanel | `.sure-crud__*` |
| `search-filter` | Search with filter controls | inline, toast | `.sure-search__*` |

## Tiers

Generation progresses through three quality tiers — same schema, different output depth:

| Feature | Vibe | Prototype | Production |
|---------|------|-----------|------------|
| Validation | Basic regex | Type + regex + DB constraints | Full + lookup datasets |
| Sanitization | Trim + escape | Full input pipeline | + DOMPurify for rich text |
| i18n | English | en + es | en + es + fr |
| Notifications | Inline | inline + toast + statusBar | All 4 modes |
| Audio | None | Error bell | Chime + speech |
| Security | Param queries | + CSRF | + Encryption + audit |
| State sync | — | — | sure-state + versioning |
| CSS themes | None | Pure CSS | Nord / Forest / Dracula |

## Sanitization Pipeline

Declarative step functions that compose into input and output pipelines:

```ts
import { sanitize, sanitizeInput, sanitizeOutput } from 'sure-factor/sanitize'

// Available steps: trim, lowercase, uppercase, stripNonDigits,
//   stripDirectionOverrides, stripZeroWidth, stripControl,
//   collapseWhitespace, htmlEscape, normalize(form), slice(n)

sanitize('  user@Example.COM  ', ['trim', 'lowercase', 'normalize(NFKC)'])
// → 'user@example.com'

sanitize('<script>alert("xss")</script>', ['htmlEscape'])
// → '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
```

## Serialization

Convert between YAML, JSON, XML, and Markdown — useful for exporting catalog definitions:

```ts
import { convert, toYaml, toJson, fromJson, toMarkdown, toXml, fromXml } from 'sure-factor/serialize'

convert(yamlString, 'yaml', 'json')    // YAML → JSON
convert(jsonString, 'json', 'yaml')    // JSON → YAML
convert(yamlString, 'yaml', 'xml')     // YAML → XML
convert(xmlString, 'xml', 'md')        // XML → Markdown
```

## Store Generation

Generate a sure-state compatible store from a schema:

```ts
import { generateStore } from 'sure-factor/generate-store'

const store = generateStore({
  tableName: 'patients',
  columns: schema.tables[0]!.columns,
  tier: 'production',
  sync: 'server-first',
  versioning: true,
})

// store.interfaceCode — TypeScript interface
// store.apiCode — API client methods
// store.storeCode — sure-state createEntityStore call
// store.fullCode — complete file
```

## Formatting

Generated output can be formatted via Prettier:

```ts
import { formatCode, formatGeneratedOutput, formatGeneratedStoreOutput } from 'sure-factor/format'

const formatted = await formatGeneratedOutput(output)
// → same as output, but with formattedRoutes, formattedTemplate, etc.
```

## Assets

| Asset | Path | Description |
|-------|------|-------------|
| i18n | `catalog/assets/i18n/{en,es,fr}.json` | Locale strings for components |
| Audio | `catalog/assets/audio/` | Error bell, success chime, voice help (JS audio generators) |
| Themes | `catalog/assets/themes/{nord,forest,dracula}.css` | Production CSS themes |
| Lookup data | `catalog/assets/data/{icd10-codes,us-zip-codes}.json` | Validation datasets |

## Related Projects

| Project | Role |
|---------|------|
| **sure-ui** | Theme CSS + notification runtime for generated output |
| **sure-state** | Client-server state sync (Zustand + WebSocket) |
| **sure-gentic** | Agent framework for LLM-powered code generation |
| **sure-web-testing** | Browser testing via MCP for generated UIs |

## Development

```bash
git clone git@github.com:ShingWong/sure-factor.git
cd sure-factor
npm install
npm run build
npm test                 # 132 tests (unit + integration)
npm run test:unit        # unit only
npm run test:e2e         # Playwright E2E
npm run lint             # tsc --noEmit
```
