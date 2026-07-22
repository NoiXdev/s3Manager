import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';

// Flat-config port of the previous .eslintrc. Kept intentionally
// non-type-checked (no parserOptions.project) to preserve the existing rule
// profile; enabling type-aware linting is a separate, larger change.
export default tseslint.config(
  {
    ignores: ['node_modules/**', '.vite/**', 'out/**', 'build/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.electron,
  importX.flatConfigs.typescript,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    settings: {
      'import-x/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
    },
  },
  {
    // Plain JS tooling (build scripts, this config) runs on Node.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Build/config files import tooling that the resolver can't always see.
    files: ['**/*.config.{ts,mts,cts}'],
    rules: { 'import-x/no-unresolved': 'off' },
  },
  {
    // The typescript-eslint / import-x meta packages mix default and named
    // exports, which trips these stylistic import checks on this config only.
    files: ['eslint.config.mjs'],
    rules: {
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },
);
