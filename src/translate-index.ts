import { runTranslateCli } from '@/cli/translate-dispatch';

/**
 * Thin process wrapper for the `translate` bin. All wiring — argument
 * parsing, the global `--corpus` flag, corpus selection at the composition
 * root, and dispatch — lives in `@/cli/translate-dispatch`, mirroring how
 * `src/index.ts` wraps `@/cli/dispatch`.
 */
runTranslateCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`translate: ${message}`);
  process.exitCode = 1;
});
