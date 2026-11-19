
## Catalog schema extension (0.6) — document parts

`CatalogComponent` may carry five optional keys for report entries: `family`,
`data`, `print`, `guards`, `fixture`. They are data, not a second registry —
sure-store/components hosts the entries and sure-document renders them.
`src/catalog.ts` validates them; `validateDocumentPart` / `assertValidDocumentPart`
fail loudly when a guard names a projection absent from `data.projection`. Do not
introduce dynamic evaluation of guard strings.

**Do not weaken the class-coverage guard.** A report entry is a document part,
not a form semantically, but the template generator emits a `sure-form` wrapper
and a `btn-primary` submit for every component. Report entries must still
declare `form` and `buttons` in `sure_ui`. The registry test validates the
`document`/`figure` blocks against the installed sure-ui (0.3.6+) via
`unpublishedBlocks`; an unpublished block fails loudly, which is not a reason
to relax coverage.

## Graphify

A queryable knowledge graph of this project is indexed at `/usr/local/devel/sure-master/graphify-out/merged-graph.json` (merged across all sure-* projects).

Query via OpenCode: `/graphify /path/to/project` or `graphify query "your question" --graph /path/to/graph.json`

Rebuild index: `graphify extract /path/to/project --code-only --out /tmp/graphify-out`
