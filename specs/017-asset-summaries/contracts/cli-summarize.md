# Contract: `bib summarize` / `bib summarize-source` CLI verbs

Mirrors `bib ocr` (`src/cli/ocr.ts`) and `translate` (`src/cli/translate.ts`). Registered in the
hand-rolled dispatch (`src/cli/parse.ts` `Command` union + `src/cli/dispatch.ts` `HANDLERS` +
help text). Belongs in the `bib` bin (reads local text + calls the LLM; NOT a governed source
fetch, so NOT `sourcequery`).

## `bib summarize <sourceId> [issueArk]`

Summarize one issue/document (or all issues of a source when `issueArk` omitted).

**Options / flags**:
- `--model <id>` — override the summarizer model (default `claude-sonnet-5`).
- `--engine <name>` — summarizer engine (default `claude`).
- `--force` — regenerate even if input-layer shas are unchanged.
- `--dry-run` — resolve inputs and report what WOULD be generated; write nothing. (Note: this is
  a LOCAL, no-external-fetch dry-run — Constitution XII's forbidden-dry-run rule is about
  *source* fetches, not local LLM generation; still, `--dry-run` writes zero artifacts.)

**Behavior**:
1. `resolveArchiveRoot`; `ensureMemberLayoutRegistered(sourceId, sourcesDir)`;
   `resolveFetchedDir(sourceId, issueArk, archiveRoot)` to locate the issue dir(s).
2. Select best-available input text (research Decision 6); **fail loud** if none (FR-003).
3. Idempotency check (input-layer shas vs sidecar); skip unless `--force`.
4. `summarizeIssue(issueDir, ctx)` → write both artifacts + sidecars via `storeAsset` (Constitution
   XV weld). Polite pacing between issues (mirror translation `PACE_MS`); consecutive-failure abort.

**Deps (constructor-injected `SummarizeCliDeps`)**: `{ archiveRoot, sourcesDir, runner, model,
preflight, clock, log, force?, dryRun? }` — built by `buildSummarizeCliDeps()` mirroring
`buildTranslateCliDeps()`.

## `bib summarize-source <sourceId>`

Generate the per-source rollup (cover-what-exists, FR-009): synthesize `source.summary.long.en.md`
+ `source.summary.short.en.md` from the source's existing issue summaries, record
`covered_issues`/`missing_issues` in provenance, then write the bibliography `summaryRef` pointer
(Decision 5) in the SAME operation (Constitution XV — no dangling reference).

## Exit / error contract

- No usable text (single issue) → non-zero exit, descriptive error, zero artifacts.
- Partial source coverage at rollup → NOT an error; covers what exists, records coverage.
- Malformed model output → non-zero exit (fail loud), zero artifacts for that issue.
