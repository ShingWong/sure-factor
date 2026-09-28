import { defineConfig } from 'vitest/config'

// Browser-backed render tests. Only files under src/e2e/ run here; everything
// else is covered by the default config, which does not need a browser.
export default defineConfig({
  test: {
    include: ['src/e2e/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
