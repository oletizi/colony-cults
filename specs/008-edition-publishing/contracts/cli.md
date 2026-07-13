# Contract: `pdf:publish` CLI

**Feature**: `specs/008-edition-publishing`

The sanctioned interface `pdf:publish` exposes — a standalone `tsx` verb in the `pdf:` / `site:`
family, wired as `"pdf:publish": "tsx scripts/publish-pdf.ts"`. It operates over PRE-BUILT PDFs
(`build/pdf/<sourceId>/<issueId>.pdf`) and never builds (FR-001). It subsumes the deliberate
public-export seam deferred from spec 007.

## Invocation

```
npm run pdf:publish -- <sourceId> --variant <english-only|parallel> --confirm
npm run pdf:publish -- <sourceId> --variant <english-only|parallel> --reconcile --confirm   # US4/FR-013
npm run pdf:publish -- <sourceId> --variant <english-only|parallel>                          # dry-run (no --confirm)
```

### Arguments & flags

| Token | Required | Meaning |
|-------|----------|---------|
| `<sourceId>` | yes | positional selector, e.g. `PB-P001` (whole source). Malformed/unknown → fail loud naming the id (G-2 parity with `pdf:build`). |
| `--variant <english-only\|parallel>` | yes | which built variant to publish. NOT inferable from the built path (both variants share `<issueId>.pdf`), so it is explicit and is recorded + encoded into the key (FR-012). |
| `--confirm` | yes to mutate | deliberate-action gate (mirrors `site:export-public`'s `--confirm` / `CORPUS_PUBLIC_EXPORT_CONFIRM`). Absent → **dry-run**: resolves, runs the rights gate, plans keys/URLs, and prints what WOULD be published/recorded — uploads and records nothing. |
| `--reconcile` | no | back-fill mode (FR-013): record already-served legacy-flat URLs for the source without upload. Mutually requires `--confirm` to write records. |
| `--out <dir>` | no | built-PDF root (default `build/pdf`, matching `pdf:build`). |
| `--no-warm` | no | skip the best-effort CDN warm (FR-015). Default: warm each new URL, non-fatally. |
| unknown `--flag` | — | fail loud: `pdf:publish: unknown flag "…"`. |

### Environment (fail-loud preflight, before any work)

- `COLONY_S3_BUCKET` / `COLONY_S3_ENDPOINT` / `COLONY_S3_REGION` + B2 credentials file →
  `resolveObjectStoreConfig()` (eager construct `S3ObjectStore`, mirroring `fetch-shared.ts`).
- `CORPUS_CDN_BASE` (e.g. `https://colony-cults-cdn.oletizi.workers.dev`) — the recorded
  canonical URL base. Unset → fail loud (no fallback).
- The archive pin (`site/data/archive-source.json` `.ref`) via `resolveArchiveRef()` — unset/
  empty → fail loud (a publication is not reproducible without the pin).

## Guarantees

- **G-1 (composable, over pre-built PDFs)**: publishes only what `pdf:build` already wrote under
  `--out`; never builds, fetches images, or runs Typst (FR-001).
- **G-2 (rights gate, fail-closed)**: refuses the WHOLE publish unless the Source carries an
  affirmative-distributable `rights.status`; the refusal names the source and the missing/
  insufficient determination and uploads/records nothing (FR-002, SC-003, Constitution IV).
- **G-3 (immutable versioned artifacts)**: each PDF → key
  `editions/<variant>/<sourceId>/<issueId>__<snapshotShort>.pdf`. A distinct build →
  distinct `snapshotShort` → distinct key; a prior key is NEVER overwritten (FR-003/FR-009).
- **G-4 (idempotent)**: for each key, `head(key)`; if it exists with the identical sha256 →
  skip the upload (no `put`). Unchanged whole re-run → zero uploads AND zero metadata change
  (FR-004, SC-004). A versioned key present with a DIFFERENT sha256 → fail loud (integrity
  contradiction; never overwrite).
- **G-5 (integrity recorded)**: every published PDF's sha256 (FR-007) + canonical CDN URL +
  key + page count are written to the per-issue manifest, referenced from a `publications[]`
  entry on the Source (FR-005/FR-006). 100% of published issues are recorded (SC-001).
- **G-6 (provenance committed)**: the SSOT + manifest changes are committed as part of
  publishing (FR-008) — no published edition without a recorded, committed provenance.
- **G-7 (attributable, fail-loud batch)**: a per-issue problem (missing built PDF for an
  enumerated issue, etc.) is recorded with its id + reason and does NOT silently vanish; the
  run prints `published N, failed M`, lists every failure, and exits non-zero if M > 0 (FR-011,
  parity with `pdf:build` G-4). No partial/placeholder content is ever published (FR-011).
- **G-8 (reconcile = back-fill only)**: `--reconcile` records the legacy-flat URLs/sha256 for
  the already-served set WITHOUT any upload; the recorded URLs match what is actually served
  (FR-013, SC-006). Marked `keyScheme: legacy-flat` in the record.
- **G-9 (warm is non-fatal)**: the post-publish CDN warm is best-effort; a `403
  download_cap_exceeded` or any warm failure is surfaced but does NOT invalidate the recorded
  publication (FR-015, spec Edge Cases).
- **G-10 (report)**: prints the published count and the canonical CDN URLs of the published
  artifacts (FR-010).

## Exit codes

| Code | Condition |
|------|-----------|
| 0 | published (or dry-ran, or reconciled) with zero failures |
| 1 | rights gate refusal, a fail-loud precondition (missing env/pin/built PDF), or any per-issue failure (M > 0) |

## Output (illustrative)

```
pdf:publish -- source PB-P001  variant english-only  (confirmed)
  rights: public-domain (basis: "…") — cleared
  snapshot: 3b8b1fd6 (pinned 3b8b1fd6a0…)
  OK    PB-P001/1879-07-15_… -> editions/english-only/PB-P001/1879-07-15_…__3b8b1fd6.pdf  (uploaded)
  SKIP  PB-P001/1879-08-15_… -> …__3b8b1fd6.pdf  (already present, sha256 match)
  …
published 71, failed 1, skipped 0
  https://colony-cults-cdn.oletizi.workers.dev/editions/english-only/PB-P001/1879-07-15_…__3b8b1fd6.pdf
  …
FAIL PB-P001/1881-11-19_…: no built PDF at build/pdf/PB-P001/1881-11-19_….pdf
```
