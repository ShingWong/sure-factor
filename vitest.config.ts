import { defineConfig } from 'vitest/config'

// Default config: every test except the browser-backed ones under src/e2e/,
// which need a real Chromium. `npm run test:unit` uses this; `npm test` runs
// this and `test:e2e` in sequence, so nothing is left uncovered.
export default defineConfig({
  test: {
    exclude: ['src/e2e/**', 'node_modules/**', 'dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
