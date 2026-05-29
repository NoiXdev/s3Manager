import { defineConfig } from 'vite';

// node-sqlite3-wasm ships a .wasm asset and resolves it relative to its own
// package directory at runtime, so it must be left external (resolved from
// node_modules) rather than bundled by Vite/Rollup.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node-sqlite3-wasm'],
    },
  },
});
