import { defineConfig } from 'vite';

// node-sqlite3-wasm ships a .wasm asset and resolves it relative to its own
// package directory at runtime, so it must be left external (resolved from
// node_modules) rather than bundled by Vite/Rollup.
export default defineConfig({
  resolve: {
    alias: [
      // The AWS SDK imports tslib helpers (`import { __extends } from 'tslib'`).
      // For the Node main build, the bundler resolves tslib's `import`/`node`
      // condition to `tslib/modules/index.js`, a shim that default-imports the
      // CJS `tslib.js` and re-exports its helpers. Rolldown (Vite 8) emits that
      // default import as `<interop>.default`, but tslib's CJS exports the
      // helpers as top-level names with no `default`/`__esModule`, so the
      // re-export destructure reads `undefined` and the packaged app crashes
      // with: "Cannot destructure property '__extends' of '...default'".
      // Aliasing to the self-contained ESM build (real named exports) bypasses
      // the CJS-reexport shim entirely. Dev (esbuild) is unaffected; this only
      // matters for the production rolldown bundle.
      { find: /^tslib$/, replacement: 'tslib/tslib.es6.mjs' },
    ],
  },
  build: {
    rollupOptions: {
      external: ['node-sqlite3-wasm'],
    },
  },
});
