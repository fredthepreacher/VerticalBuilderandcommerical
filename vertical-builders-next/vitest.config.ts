import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// fileURLToPath, not URL.pathname: pathname keeps %20 for spaces in the checkout path (and a leading
// slash before the Windows drive letter), so the aliases would point nowhere.
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url)).replace(/\\/g, '/')

export default defineConfig({
  // Only needed so the component smoke tests can compile JSX. The application
  // itself is built by Next, which is unaffected by this file.
  plugins: [react()],
  test: {
    environment: 'node',
    // `.tsx` is included for the Phase 3 component smoke tests. Those files opt
    // into jsdom individually with an `@vitest-environment jsdom` docblock, so
    // the rest of the suite keeps running in the faster node environment.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    alias: {
      // Mirrors the `@/*` path mapping in tsconfig.json so the component smoke
      // tests can import application modules exactly as the app does.
      '@': fromRoot('./').replace(/\/$/, ''),
      // `server-only` is a Next.js build-time guard with no runtime behaviour.
      // Unit tests import the same modules directly, so it is stubbed here
      // rather than removed from the source — the guard is doing real work in
      // the app and must stay.
      'server-only': fromRoot('./tests/stubs/server-only.ts'),
    },
  },
})
