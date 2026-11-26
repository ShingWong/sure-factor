
## Catalog schema extension (0.6) — document parts

`CatalogComponent` may carry five optional keys for report entries: `family`,
`data`, `print`, `guards`, `fixture`. They are data, not a second registry —
sure-store/components hosts the entries and sure-document renders them.
`src/catalog.ts` validates them; `validateDocumentPart` / `assertValidDocumentPart`
fail loudly when a guard names a projection absent from `data.projection`. Do not
introduce dynamic evaluation of guard strings.

**Server target: one resource per call.** `generateForTier` takes `tableName`
(or `resource`) in `GenerateOptions` and scopes fields, routes, i18n, validation
and sanitisation to that table; without the option it uses the first table (the
old routes default), so single-table callers keep working. Multi-table callers
must call once per table — never flatten unrelated tables into one form.
Template shape follows the component: forms keep htmx/express `<form>` markup,
`data-table` emits a real `<table>` with sure-ui `.sure-table__*` classes and
`{{#each rows}}` cells, and document parts emit their own markup.

**Do not weaken the class-coverage guard.** A report entry is a document part,
not a form: pass its definition via `GenerateOptions.componentDefinition` and
the server template emits a sure-ui `document` section (table or figure) with
**no `sure-form` wrapper and no `btn-primary` submit**. Its `family`/`data`/
`print`/`guards`/`fixture` keys still go through `validateDocumentPart` /
`assertValidDocumentPart` and fail loudly when invalid. Published entries still
declare `form` and `buttons` in `sure_ui`; the registry test validates the
`document`/`figure` blocks against the installed sure-ui (0.3.6+) via
`unpublishedBlocks` and still checks that coverage — an unpublished block fails
loudly, which is not a reason to relax the guards.

## Graphify

A queryable knowledge graph of this project is indexed at `/usr/local/devel/sure-master/graphify-out/merged-graph.json` (merged across all sure-* projects).

Query via OpenCode: `/graphify /path/to/project` or `graphify query "your question" --graph /path/to/graph.json`

Rebuild index: `graphify extract /path/to/project --code-only --out /tmp/graphify-out`
