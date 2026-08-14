import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: true,
    include: ['packages/*/test/**/*.test.ts'],
    // `tsc -b` only covers packages/*/src, so a type error inside a test file
    // would otherwise be invisible to `npm run typecheck`. Vitest's typecheck
    // mode covers the gap; the root `typecheck` script runs it via
    // `vitest --typecheck.only --run`.
    typecheck: {
      enabled: false,
      include: ['packages/*/test/**/*.test.ts'],
      tsconfig: './tsconfig.test.json',
    },
  },
});
