import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // Declaration generation is disabled here because tsup's bundled
  // rollup-plugin-dts@6.1.1 is incompatible with this package's TypeScript
  // version. Declarations are produced instead by `tsc --emitDeclarationOnly`
  // in the package's `build` script, which then copies dist/index.d.ts to
  // dist/index.d.cts so CJS TypeScript consumers resolve types too.
  dts: false,
  splitting: false,
  sourcemap: false,
  clean: true,
});
