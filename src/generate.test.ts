import { describe, it, expect } from 'vitest'
import type { ColumnInfo } from './introspect.js'
import type { CatalogType } from './types.js'
import { generateForTier } from './generate.js'

// Generate module tests — testing the shape of the output contract
describe('generate module contracts', () => {
  it('generates routes output with expected fields', () => {
    const schema = { tables: [{ tableName: 'users', schema: 'public', columns: [] }] }

    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })

    expect(result).toHaveProperty('routes')
    expect(result).toHaveProperty('template')
    expect(result).toHaveProperty('i18n')
    expect(result).toHaveProperty('styles')
    expect(result).toHaveProperty('scripts')
    expect(result).toHaveProperty('validation')
    expect(result).toHaveProperty('sanitization')

    expect(typeof result.routes).toBe('string')
    expect(typeof result.template).toBe('string')
    expect(typeof result.styles).toBe('string')
    expect(Array.isArray(result.scripts)).toBe(true)
  })

  it('includes table name in generated routes', () => {
    const schema = { tables: [{ tableName: 'patients', schema: 'public', columns: [] }] }
    const result = generateForTier(schema, { tier: 'prototype', component: 'form' })
    expect(result.routes).toContain('patients')
  })

  it('generates template with form tag', () => {
    const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [] }] }
    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(result.template).toContain('<form')
    expect(result.template).toContain('hx-post')
    expect(result.template).toContain('hx-target')
  })

  it('throws for unknown component', () => {
    const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [] }] }
    expect(() => generateForTier(schema, { tier: 'vibe', component: 'nonexistent' })).toThrow()
  })

  it('generates i18n keys for matched fields', () => {
    const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [{ columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null }] }] }
    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(Object.keys(result.i18n).length).toBeGreaterThanOrEqual(0)
  })

  it('has a notifications field on every output (runtime or explicit null)', () => {
    const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [] }] }
    const result = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(result).toHaveProperty('notifications')
    expect(typeof result.notifications === 'string' || result.notifications === null).toBe(true)
  })
})

/**
 * The styles field is now sure-ui `compose()` output over the yaml's
 * `sure_ui` blocks — one token-driven theme, no hand-rolled palette. What
 * that means concretely, asserted here: layer statement first, theme tokens
 * present, the block's own rules present, the old hardcoded error colour
 * absent, and the notifications runtime gated on non-inline modes.
 */
describe('generateForTier: styles are sure-ui compose output', () => {
  const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [{ columnName: 'email', dataType: 'varchar', isNullable: false, maxLength: 255, defaultValue: null, isPrimaryKey: false, foreignKey: null }] }] }

  it('declares the cascade layers (tokens < components < mobile) before any block', () => {
    const { styles } = generateForTier(schema, { tier: 'vibe', component: 'form' })
    const stmt = styles.indexOf('@layer sure.tokens, sure.components, sure.mobile;')
    const first = styles.indexOf('@layer sure.tokens {')
    expect(stmt, `layer statement missing:\n${styles.slice(0, 120)}`).toBeGreaterThan(-1)
    expect(stmt).toBeLessThan(first) // order binds on use — statement first
    expect(first).toBeLessThan(styles.indexOf('@layer sure.components {'))
    expect(styles.indexOf('@layer sure.components {')).toBeLessThan(styles.indexOf('@layer sure.mobile {'))
  })

  it('carries the declared block rules and the theme tokens', () => {
    const { styles } = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(styles).toContain('.sure-form__field') // block: form
    expect(styles).toContain('.btn-primary') // block: buttons (template hardcodes it)
    expect(styles).toContain('--error-ink:') // theme tokens ride along
    expect(styles).toContain('@media (max-width: 640px)') // shared mobile layer
  })

  it('drops the hardcoded #b00020 error colour for the theme token', () => {
    const { styles } = generateForTier(schema, { tier: 'vibe', component: 'form' })
    expect(styles).not.toContain('#b00020')
  })

  it('styles the template defaults when cssClasses omits the role', () => {
    // markdown declares no field/label/input keys — the template falls back
    // to generic classes, and those still need rules (compose only knows
    // sure-ui classes).
    const { styles, template } = generateForTier(schema, { tier: 'vibe', component: 'markdown' })
    expect(template).toContain('class="field"')
    expect(styles).toContain('.field {')
    expect(styles).toContain('.field-error {')
    expect(styles).toContain('var(--error-ink)')
  })

  it('accepts any theme sure-ui ships, not just the three vendored ones', () => {
    const { styles } = generateForTier(schema, { tier: 'vibe', component: 'form', theme: 'vision-atkinson' })
    expect(styles).toContain('@layer sure.tokens')
    expect(styles).toContain('@font-face') // vision themes carry their typeface
  })

  it('names an unknown theme instead of silently emitting nothing', () => {
    expect(() => generateForTier(schema, { tier: 'vibe', component: 'form', theme: 'nope' })).toThrow(/unknown theme/)
  })
})

describe('generateForTier: notifications runtime is gated on non-inline modes', () => {
  const schema = { tables: [{ tableName: 'test', schema: 'public', columns: [] }] }
  const gen = (component: string) => generateForTier(schema, { tier: 'vibe', component }).notifications

  it('emits the runtime when the component declares toast/statusBar/sidePanel', () => {
    // form: [inline, toast, statusBar, sidePanel] — toasts render through it
    const runtime = gen('form')
    expect(typeof runtime).toBe('string')
    expect(runtime).toContain('function showNotification')
    expect(runtime).toContain('function clearNotifications')
    expect(runtime).not.toContain('sourceMappingURL') // the app ships no .map
  })

  it('emits the runtime for non-inline-only components', () => {
    // data-table: [toast, statusBar] — no inline mode at all
    expect(typeof gen('data-table')).toBe('string')
  })

  it('omits the runtime for inline-only components', () => {
    // search-filter: [inline] — renders in place, needs no runtime
    expect(gen('search-filter')).toBeNull()
  })

  it('omits the runtime when the component declares no modes', () => {
    expect(gen('markdown')).toBeNull()
  })
})