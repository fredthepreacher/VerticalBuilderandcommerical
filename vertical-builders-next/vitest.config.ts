import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    alias: {
      // `server-only` is a Next.js build-time guard with no runtime behaviour.
      // Unit tests import the same modules directly, so it is stubbed here
      // rather than removed from the source — the guard is doing real work in
      // the app and must stay.
      'server-only': new URL('./tests/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
})
