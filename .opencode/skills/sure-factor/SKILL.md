---
name: sure-factor
description: Use when generating or changing UI from a database schema with @shing.wong/sure-factor — adding a form or table view, matching a column to a type, adding a field or validation rule, or regenerating generated components. Covers scoping the schema, the catalog, the three-tier presets, and why you edit the spec and regenerate rather than editing generated code.
---

# sure-factor

Turns a database schema into UI: it matches columns to types in a catalog, then
generates forms, tables and stores. This skill is the non-obvious part — what to
read, what to skip, and what not to edit.

## The pipeline

Five composable calls. Each step's output is the next step's input.

```ts
import {
  introspectSchemaFromDdl,  // DDL string  -> SchemaInfo
  loadAllTypesSync,          // -> CatalogType[]  (the catalog)
  matchColumnToTypeSync,     // ColumnInfo -> TypeMatchResult | null
  generateClientComponent,   // SchemaInfo -> { module, fields, cssClasses }
  generateStore,             // SchemaInfo -> store module
} from "@shing.wong/sure-factor"
```

`introspectSchema` is the same thing against a live database. Everything else is
synchronous and needs no connection.

## Scope the schema before you introspect it

`introspectSchemaFromDdl` takes a **DDL string**, not a database handle. Pass the
one `CREATE TABLE` you care about rather than the whole file.

```ts
// Don't: 25 tables when you need one. 5,043 tokens on the management schema.
const all = introspectSchemaFromDdl(allDdl)

// Do: slice first. 282 tokens, identical columns.
const ddl = /CREATE TABLE IF NOT EXISTS tickets \([^;]*\);/i.exec(allDdl)![0]
const schema = introspectSchemaFromDdl(ddl)
```

Measured on `positronic/management` (25 tables): 5,043 → 282 tokens, a 94%
reduction. This is a caller-side slice, not a library option — there is no
filter parameter and you do not need one.

The pattern is literal, so keep the `IF NOT EXISTS` when your DDL has it — a
migration-style schema will not match `CREATE TABLE tickets` on its own. Either
form parses; it is the regex that has to match your file. If it returns `null`,
your DDL spells the clause differently than the pattern does.

## Take columns out of the schema, never build one

`matchColumnToTypeSync` takes a column name, or a `ColumnInfo`. Taking it from
the schema is the right default, because the `dataType` is what lets the catalog
apply its `data_type` rules.

```ts
// Fine — name only, matched on the name rules.
matchColumnToTypeSync("email", types)!.type.name        // "email"

// Better — carries dataType, so data_type rules can also fire.
const col = schema.tables[0].columns.find(c => c.columnName === "subject")!
matchColumnToTypeSync(col, types)                       // -> text (no type claims it)
```

A name alone will not match a type whose only rule is on `data_type`; the result
is `null` rather than a guess. If you expect a match and get `null`, you passed a
bare string for a column that needs its data type.

Do not construct a partial `ColumnInfo` by hand to get the data type — the rules
read `maxLength` too, and a hand-built object is a bug waiting to happen. Take the
column from the schema.

`null` also means "no type claims this column", which is normal: `subject`,
`status` and `quantity` have no catalog type and fall back to `text`. To give a
column a type, rename it to something the catalog recognises, or add a type to
`catalog/types/`.

## Read the catalog, do not dump it

`loadAllTypesSync()` returns all 16 types — 7,532 tokens as JSON. The catalog is
YAML on disk, one type per file, and one type is the unit you want.

```bash
cat node_modules/@shing.wong/sure-factor/catalog/types/email.yaml   # 2.3 KB
```

Read the file for the type you care about. Use the loader when you need to match
many columns at once.

A type carries `match` (how a column is recognised), `validation`, `sanitize`
(input and output), `hints` per locale, and `tiers`.

## Pick a tier, and know what it costs

`vibe`, `prototype`, `production` are presets, not quality settings. They trade
validation strictness for less code.

| tier | email type size | what you get |
|---|---|---|
| `vibe` | 147 B | a loose regex |
| `prototype` | 414 B | a real regex, no extras |
| `production` | 499 B | full recipe plus sanitisation |

Use `vibe` for a throwaway, `production` for anything that stores a value. The
default is `production`; pass the tier explicitly when you mean something else.

## `styles` is sure-ui compose, `notifications` is gated on the mode

`generateForTier` returns two output fields whose shape depends on the
component yaml, not on guesswork:

- **`styles`** is [`@shing.wong/sure-ui`](https://github.com/ShingWong/sure-ui)
  `compose()` output over the yaml's `sure_ui: [blocks]` — tokens plus the
  blocks the markup needs, in cascade layers. Do not add a second stylesheet
  on top: consumer CSS is unlayered and wins over the theme regardless of
  specificity, which pins the page to one palette (see below). The registry
  test (`src/registry.test.ts`) keeps `sure_ui` in step with both the yaml's
  `cssClasses` and sure-ui's `COMPONENTS`.
- **`notifications`** is the `showNotification`/`clearNotifications` runtime
  source — present (`string`) only when `behavior.notificationModes`
  declares a non-inline mode (`toast`, `statusBar`, `sidePanel`), `null`
  otherwise. Write it to `notifications.js` when present; an inline-only
  component needs no runtime, and shipping one invites imports that are
  never called.

## Menus come from the catalog, items from the app

`horizontal-icon-menu` generates a `renderMenu` module. Items are application
chrome — `{ id, label, icon?, href?, active?, dividerBefore? }` — so the
generated module carries no fields:

```ts
const nav = renderMenu({
  position: 'right',
  items: [
    { id: 'calculator', label: 'Loan calculator', icon: '🧮', href: '/app.html', active: true },
    { id: 'settings', label: 'Settings', icon: '⚙', dividerBefore: true },
  ],
  onSelect: (item) => openSettings(item),
})
```

Use it instead of hand-writing buttons: the classes, active state and
`aria-current` are the catalog's. Icons may be inline SVG (they inherit
`currentColor`, so they follow the theme) or a character — prefer SVG for
application chrome, because an emoji carries its own palette. `align: 'end'`
pins an item (and a divider before it) to the far edge: sign out belongs there,
not among the pages.

For prose and page chrome, prefer the string renderers over DOM: `renderFooter()`
for the last line of a page (copyright, legal links, build credit) and
`renderMarkdown()` for documents. Both are escape-first, validate link
destinations against a protocol allowlist, and return HTML a build can write
into static pages — so they work with scripts disabled, which is what legal
pages and printouts need.

## Group the fields in the schema

A long form is easier to use when it is in sections, and the section a field
belongs to is schema knowledge, not page knowledge. Add a `group:` line to the
column comment:

```sql
COMMENT ON COLUMN policy_intake.deductible IS 'Deductible
group: Coverage';
```

`renderForm` then emits one `<section class="sure-form__group" data-group="coverage">`
per group, in first-appearance order, with the group name as its heading. Fields
with no group render first, outside any section. The generated field also
carries `data-field="<name>"`, and help and error share one
`.sure-form__message` row — always present, so a grouped layout can reserve it.

Layout stays with the consumer: `sure-ui` reads `--sure-form-columns`,
`--sure-form-field-span` and `--sure-form-max-width`. See
`sure-examples/grouped-form` for a worked example with geometry tests.

## Put the words in the schema, not in a fork

A column's `COMMENT ON COLUMN` is where its UI words belong: **the first line
is the label, anything after it is help**. Without a comment the label is
derived mechanically (`payment_amount` → "Payment amount"), which is fine for
`email` and wrong for `MVR` or `Tax ID`.

```sql
COMMENT ON COLUMN contracts.mvr IS 'MVR
Motor Vehicle Record fee.';
```

The generator reads the column's SQL type for the control: `numeric`/`integer`
→ number input, `date` → date picker (ISO), plus the catalog type for email,
password and phone. A `CHECK (x IN (…))` becomes a `<select>` with those
options. If a field needs a control the schema cannot express, extend the
catalog — do not post-process the generated module.

## Edit the spec, regenerate; never edit generated code

Generated modules are large because they are complete: a 7-field form is 16,856
chars, and each extra field adds roughly 700. The 25-table module is ~100,000
chars — **16,856 of that is fixed boilerplate that does not change when a field
does.**

To change one field, change the input and regenerate. Do not read a generated
module to find the field, and do not edit the module to change the field.

```ts
// Change the source of truth, then regenerate.
const result = generateClientComponent(schema, {
  tier: "production",
  component: "form",       // or "data-table"
  exportName: "TicketsForm",
})
```

`component` picks a template from `catalog/components/`: `form`, `data-table`,
`form-modal`, `crud-resource`, `search-filter`, `dialog`, and the auth ones.
A `data-table` component renders a `<table>`, not a form.

The result carries `module` (TypeScript source), `fields`, and `cssClasses`.
The class names are a contract between the generator and `sure-ui` — pass them
through, do not hardcode `sure-form__field` in a consumer.

## Check the output parses, then check what it does

`tsc --noEmit` on the emitted module. It is TypeScript and declares its own
spec interfaces, so a `new Function` probe fails on the interfaces rather than
on a real defect.

Then exercise the functions the module exports — `validateForm`, `sanitizeForm`
if it is a form. Reading the source tells you a function exists; calling it
tells you it works. A generated sanitiser that compiles and does nothing is
exactly the defect worth testing for.

Commit the generated module. It is the artefact the application builds, and a
suite that compiles a committed module without regenerating can be green
against a module no generator would produce.

## What this skill does not cover

- **Server targets.** `generateForTier` emits Handlebars + htmx + express.
  `generateClientComponent` emits plain DOM with no framework or dependencies.
  Pick by what the application is.
- **Runtime UI styling.** `sure-ui` owns the class names; a consumer should not
  restyle them, and a hardcoded colour in a consumer's stylesheet wins over the
  theme and pins the page to one palette.
- **Sanitisation is not a security boundary.** It is a UX convenience. The
  server re-validates every argument; treat the client copy as presentation.

## Where the machine-readable version lives

`tsc` emits `.d.ts` for every export into `dist/` on each build — signatures,
argument shapes and tier unions, always current. Read those rather than trusting
this file for shapes. What no declaration carries is *which* call to make, which
is what the rest of this document is for.
