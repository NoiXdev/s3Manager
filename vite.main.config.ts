import { defineConfig } from 'vite';

// better-sqlite3 is a native module; it must be resolved at runtime from
// node_modules (unpacked by @electron-forge/plugin-auto-unpack-natives), not
// bundled by Vite/Rollup.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3'],
    },
  },
});
