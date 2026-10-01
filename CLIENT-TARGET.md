# Why

The console is a client-side SPA. `generateForTier` emits Handlebars + htmx +
express, none of which the console can use — it needs DOM-building code. The
attempt to build the console's components out of sure-factor therefore needed a
second output target before anything could be generated.

Found by dogfooding: running the generator against the real positronic
management DDL exposed that the two catalog components the console relies on
(`form`, `data-table`) did not actually declare the full class contract. The
console emitted `sure-form__title` and `sure-form__actions`, which no catalog
entry mentioned and no theme styled — 2 of the 37 classes the console emits
were unstyled by anything.

## What this adds

`generateClientComponent(schema, { tier, component, exportName })` emits a
self-contained TypeScript ES module:

- `h(tag, props, ...children)` — a small typed element factory
- `renderField(field, value, error, busy, onChange)`
- `renderForm(spec, options)` — renders a `FormSpec` into a form element
- `GENERATED_FIELDS` — the field specs, for a server to serialise
- `CSS_CLASSES` — the contract the module was generated against

No framework, no runtime dependency. The form is driven by a spec supplied at
runtime, so one generated module serves every entity rather than baking one
form per call.

## The class names come from the catalog

`form.yaml` and `data-table.yaml` gained the keys the console was already
emitting, so the generator and the runtime cannot drift:

    title: sure-form__title
    actions: sure-form__actions
    submit: btn-primary
    cancel: btn-secondary

A test asserts every class the console renders is declared, so a future
component cannot quietly introduce an unstyled one.

## Accessibility is preserved

The React renderer set `aria-invalid`, `aria-describedby`, `role="alert"`,
`aria-hidden` on the required marker, and `novalidate`. Those are asserted in
the tests, and verified in a real DOM:

    aria-invalid     true          (on the erroring control)
    aria-describedby field-display_name-error
    error id matches describedby   true
    error message role             alert

## Shared internals

`generate-internal.ts` holds `uniqueKey`, `toRegexLiteral`,
`sanitizeStepLiteral` and `objectBody`. Both targets use them, so the server
and client generators agree about a column's key, its regex escaping and its
sanitisation steps — which is what keeps the two from producing different
answers for the same column. `generate-client.ts` imports only from there and
from `generate.ts`'s types, so there is no cycle.

## Verification

- 214 unit + 3 e2e tests pass. The 13 new ones include a `tsc --strict` probe
  of the emitted module, not a regex.
- That probe caught a real defect in this generator: embedded fields carried
  `placeholder`/`help` at the top level while the emitted `FieldSpec` declares
  them under `hints`, so the module did not type-check. Fixed.
- Compiled the emitted module and ran it under jsdom: renders `<form>` with 4
  fields, 4 labels, 4 controls, correct aria wiring, `onChange` fires on
  input, submit and cancel both fire, `busy` disables 4 elements.
- 125 fields generated from the positronic DDL with no duplicate names; the
  repeated `updated_at` is table-qualified in both tables.
- Class names emitted, all from the catalog: `sure-form`, `sure-form__field`,
  `sure-form__label`, `sure-form__help`, `sure-form__title`,
  `sure-form__actions`, `btn-primary`, `btn-secondary`.

## Not done here

This makes generation possible; it does not yet migrate the console. The pages
are still React, and the console still carries its own hand-written CSS. That
is the next piece of work, and it should land behind a jsdom test environment
for the console first — it currently has no client-side tests at all.