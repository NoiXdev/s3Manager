import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
          exclude: ['src/renderer/**'],
        },
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
