import { isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'

import { defaultServerConditions, defaultServerMainFields, defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  resolve: {
    conditions: [...defaultServerConditions],
    mainFields: [...defaultServerMainFields],
  },
  build: {
    target: 'node24',
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    sourcemap: true,
    minify: false,
    rolldownOptions: {
      platform: 'node',
      external: (id) =>
        isBuiltin(id) || /^@earendil-works\/pi-(coding-agent|tui|ai|agent-core)(?:\/|$)/.test(id),
    },
  },
})
