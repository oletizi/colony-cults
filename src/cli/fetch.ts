/**
 * `fetch-issue`/`fetch-source` command surface (contracts/cli.md).
 *
 * Implementation lives in `src/cli/fetch-shared.ts` (types/deps/helpers
 * common to both commands), `src/cli/fetch-issue.ts`, and
 * `src/cli/fetch-source.ts` -- split out (T034/T036) to keep each file under
 * the project's file-size guideline. This module re-exports the stable
 * public surface so existing imports of `@/cli/fetch` keep working.
 */
export {
  type FetchCliClient,
  type FetchDeps,
  defaultFetchDeps,
  requireOption,
} from '@/cli/fetch-shared';
export { runFetchIssue } from '@/cli/fetch-issue';
export { runFetchSource } from '@/cli/fetch-source';
