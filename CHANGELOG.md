# Changelog

All notable changes to this package are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-10-23

### Fixed

- **Columns whose names begin with a constraint keyword were dropped.** The
  table-constraint filter compared with `startsWith`, so `checking_name`,
  `checking_last4` and `checking_route` were read as `CHECK` constraints and
  silently discarded — in a payments schema, exactly the columns you cannot
  lose. The same trap sat on `CONSTRAINT`, `UNIQUE` and `EXCLUDE`.

  Constraint detection now requires the keyword as a whole word (`CHECK (` for
  the check clause), so a column named `checking_*` or `unique_code` parses
  normally.

## [0.5.2] - 2026-10-23

### Fixed

- **A plain text column submitted as an empty string.** The catalog's `text`
  type ends its sanitise recipe with `slice(0, maxLength)`; the emitted step
  passed the literal token `maxLength` to `String.prototype.slice`, which
  coerces to `NaN` and therefore to `0` — so any field whose catalog type
  declares no `maxLength` was blanked on submit. Found in a real application
  where every free-text field (`insurance_comp_1`, `customer_address`, …)
  vanished on save, and the browser's own submit path silently produced `''`.

  The bound is now resolved before the step runs: the token maps to the
  field's `maxLength`, and an unbounded or unparseable value leaves the string
  alone instead of truncating it.

## [0.5.1] - 2026-10-23

### Fixed — the generated UI now matches the schema it came from

Six defects found while building a real application (sun-portal) from a real
DDL file. Each one produced output that compiled, passed the existing tests,
and was wrong in the browser.

- **A `--` comment inside a table body was parsed as a column.** A comment
  containing a parenthesis swallowed the column after it, because the block
  scanner balances parens. Comments (`-- …` and `/* … */`) are now stripped
  before parsing, with string literals and quoted identifiers left intact, so
  a commented-out statement is ignored too.

- **A catalog rule's `data_type` clause was ignored once the column name
  matched.** `date-us` (MM/DD/YYYY text) attached itself to `TIMESTAMPTZ`
  columns whose name contains "date", and any phone-named column claimed the
  narrow US-phone rule regardless of width. A branch that names a `data_type`
  must now satisfy it; `varchar(N)` is read as "fits N characters", and
  `data_type = 'date'` — which `date-iso` relies on — is honoured at last.

- **`credit-card`'s `%cc%` rule matched `account` and `acct`.** An account
  number or a prior-balance amount became a 13–19 digit card field. Card
  columns are now matched by name (`%card%`, `%credit%`, `%cc_num%`,
  `cc_%`).

- **Every control rendered as `type="text"`.** `inputTypeForColumn()` existed
  but was dead code: money, counts and dates were plain text boxes, and a
  `CHECK (x IN (…))` enumeration had no way to become a select. Field specs now
  carry `inputType` (number, date, email, password, tel) and `options`, and the
  emitted renderer uses both.

- **The control never received its catalog class.** `sure-form__input` was
  declared in `CSS_CLASSES` and interpolated nowhere, so any theme rule scoped
  to the component silently missed. Controls now carry the class from the
  catalog's `cssClasses`.

- **`COMMENT ON COLUMN` was unused.** Labels were the mechanical snake_case
  derivation, so `mvr` rendered as "Mvr". A column comment now supplies the
  label (first line) and help text (the rest).

### Changed

- `matchColumnToTypeSync` / `matchColumnToType` scoring: see the `data_type`
  fix above. A real `DATE` column now matches `date-iso` rather than
  `date-us`; a bare column name still matches a rule that also declares a type
  (the type is unconfirmable without a `ColumnInfo`), but a type-only rule no
  longer matches a bare name.

- `ColumnInfo` gained optional `comment` and `enumValues` fields.

- `ClientFieldSpec` gained `inputType` and `options`.

## [0.2.0] - 2026-09-28

### Security

- **`sanitizeOutput(value, true)` is no longer a pass-through.** When `richText`
  was true the value was returned verbatim, disabling all sanitisation. The
  function is exported from the package root and had no internal callers, so
  nothing enforced the "already-safe HTML" contract it assumed; any caller
  passing untrusted text was a direct XSS vector.

  Rich text is now filtered against a tag and attribute allowlist. Disallowed
  elements are dropped while their inner text is kept, raw-text elements
  (`script`, `style`, `textarea`, `title`) are dropped with their body, all
  `on*` handlers are stripped, and `javascript:`, `data:` and `vbscript:` URLs
  are rejected. Safe markup such as `<p>hi <strong>there</strong></p>` is
  unchanged.

  **Breaking for callers** that passed pre-sanitised HTML containing elements
  outside the allowlist. `table`, `img`, `form`, `input`, `select`, `button`
  and `video` are **not** currently permitted. Review those call sites, or
  sanitize with an allowlist that matches your needs.

- **Code injection in generated store files.** `generateStore` interpolated a
  caller-supplied `apiPath` into both single-quoted string literals and template
  literals using one escaper that escaped quotes and backticks but not `$` or
  `{`. An `apiPath` of `/api/${require("fs")}` became live interpolation in the
  generated file, injecting arbitrary code into a consumer's bundle. Escaping is
  now context-specific.

### Fixed

- **`parseYaml` silently dropped all but the first item of every object-style
  array.** Six of the fourteen shipped catalog components lost data:
  `crud-resource.yaml` declared 7 columns and kept 2, and `auth-login.yaml`
  parsed to just `email` with `password` dropped. Nothing failed loudly and the
  existing 128 tests all passed. The open array is now tracked with an
  indent-scoped stack, which also handles a block array nested inside an array
  item.

- **`introspectSchemaFromDdl` truncated every multi-column table.** The non-greedy
  `([\s\S]*?)\)` stopped at the first `)`, normally inside `VARCHAR(255)` or
  `DEFAULT NOW()`. Replaced with balanced-paren scanning, plus top-level comma
  splitting so `DECIMAL(10, 2)` stays intact.

- **`introspectSchemaFromDdl` skipped quoted identifiers.** `CREATE TABLE "User"`
  and names containing spaces (`"user data"`) were not matched. Quoted and
  schema-qualified identifiers are now handled, and a trailing semicolon is
  optional.

- **`slice` could wipe a value or emit malformed Unicode.** Non-finite bounds
  turned `'hello'.slice(0, NaN)` into `''`, silently blanking the input.
  Truncating at `maxLength` could also split a surrogate pair. Both are now
  rejected and repaired respectively.

- **`normalize` threw `RangeError` on an unknown form.** The form originates in
  free-form catalog or config text, so a typo such as `NFKC1` crashed the
  pipeline. It now falls back to NFKC and warns.

- **Anti-spoofing filter had gaps.** The bidi override and embedding set was a
  hand-listed subset that omitted `U+202A`-`U+202C`, the deprecated
  `U+206A`-`U+206F` range, and `U+061C`/`U+200E`/`U+200F`; the C1 control range
  was not stripped at all. An invisible direction-changing character could
  still reorder rendered text.

- **Silent failures in `formatCode`.** A broken Prettier install was
  indistinguishable from unparsable input, and the resolved module was cached
  rather than the in-flight promise, so a failed import re-ran on every call.
  The two failure modes are now distinct, the fallback warns, and the import is
  memoized.

- **Ignored sanitize steps failed open.** A mistyped step silently disabled that
  transformation with no signal. The documented skip behaviour is unchanged, but
  it now warns.

### Added

- **`introspectSchema` is implemented.** It was a stub that always threw
  "Not implemented yet" while silently discarding its `connectionString` and
  `schemas` arguments. It now queries `information_schema` for tables, columns
  and primary/foreign key constraints, honours the `schemas` argument via a bound
  parameter, validates its inputs, and accepts an injected client for testing.

- **`pg` is a regular dependency**, so live introspection works without a manual
  install. Previously it would have required `npm install pg`.

- **`introspectSchemaFromDdl` and `PostgresConnectionError` are exported from the
  package root.** `introspectSchemaFromDdl` was unreachable from the entry
  point, leaving consumers without a database connection no usable entry point.

### Changed

- **Generated string literals now use double quotes.** `esc` switched from
  hand-rolled escaping to `JSON.stringify`, so emitted literals are
  double-quoted where they were previously single-quoted. Semantically
  equivalent; tests asserting the old output were updated.

- **Declared `engines.node >= 20`**, matching what ES2022 output and the
  dependency set already required but did not state.

- **Test artifacts are no longer emitted into `dist`.** `tsc` previously
  compiled test files into the build output (48 files). A separate
  `tsconfig.build.json` handles this for the emit step only, so `npm run lint`
  still typechecks every test file.

- **Unit and end-to-end tests are separated by directory.** `test:e2e` previously
  ran the entire suite with longer timeouts rather than only the browser-backed
  tests, because its vitest config set no `include`. `test:unit` now excludes
  `src/e2e/**` and `test:e2e` includes it; `npm test` runs both.

- **Added an `npm run verify` script** covering lint, build, test and package
  export resolution, plus a GitHub Actions workflow that runs it on push and pull
  request.

### Removed

- **Removed `src/visual-e2e.test.ts`.** It was tooling for a cross-project
  workflow rather than a test of this package, driving a browser through the
  `agentic-web-testing` MCP server spawned from a hardcoded absolute path to a
  different repository. It could not pass in this checkout and had been failing
  in the default run since the initial commit.

## [0.1.1] - 2026-04-05

- Repaired `.gitignore` and completed `.npmignore`.
- Exposed sync matchers on the root barrel; scoped README imports.
- Renamed the package to `@shing.wong/sure-factor`.
- Emit Node-resolvable ESM specifiers.

## [0.1.0]

- Initial release.
