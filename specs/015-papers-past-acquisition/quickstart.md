# Quickstart / Validation Guide: Papers Past Acquisition Adapter

Runnable scenarios that prove the feature works end to end. Details live in [contracts/](./contracts) and [data-model.md](./data-model.md).

## Prerequisites

- Repo deps installed; the spec-014 real-browser client available (`npx playwright install chrome`) for the live scenario only.
- For the live acquisition: `COLONY_ARCHIVE_ROOT` (per-session archive clone) + B2 credentials configured (`.env` + `~/.config/backblaze/b2-credentials.txt`).

## Scenario 1 — Acquire a public-domain article (unit, hermetic)

Fake `BrowserSession` scripts the persisted de Rays article HTML; fake `byteFetch` returns valid GIF bytes per segment; fake `ObjectStore` records puts. Drive `acquire` on a record assessed `public-domain`.

Expect: N `page-master` GIF assets put under `archive/papers-past/<id>/<sha256>.gif`; assets + provenance returned; deterministic keys. (No OCR asset — OCR is out of scope for the adapter; clarified 2026-07-19.)

## Scenario 2 — Rights fail-closed (unit)

`acquire` on a record with no assessment, and one assessed `restricted`. Expect: fail-loud refusal BEFORE any `byteFetch`/`objectStore` call — the fakes record 0 calls (SC-002/SC-004).

## Scenario 3 — Idempotency + dry-run (unit)

Re-run `acquire` with the fake object store already holding the segments at matching checksums → 0 duplicate puts (idempotent). Run with `dryRun` → 0 puts, 0 record mutation (SC-003).

## Scenario 4 — Image-validity guard (unit)

Fake `byteFetch` returns a non-image / WAF-challenge body for a segment. Expect: `acquire` throws (never mirrors a challenge page as a facsimile) — the image-CDN-WAF edge case.

## Scenario 5 — Image-CDN reachability verification (env-gated, one-time)

Fetch one real `/imageserver/...` URL via the polite `HttpClient`. Expect a valid GIF (hybrid confirmed) OR a challenge (then build the browser byte-fetch fallback per research R1). Manual, not in CI.

## Scenario 6 — Live end-to-end acquisition (env-gated)

With the NZ-press source-group member (the de Rays article, assessed public-domain) and archive/B2 configured: `bib acquire <member>`. Expect exit 0; the article's page-image facsimile held in the archive clone + B2 with provenance; `bib show` reflects the held assets. Re-run → idempotent. Requires `RUN_PAPERS_PAST_ACQUIRE=1`. (OCR produced downstream by the existing OCR pipeline, not by this adapter.)

### One-time live-acquire smoke (operator acceptance — T021/T023)

The member is `PB-P061` (article `HNS18840103.2.19.3`, `partOf` group `PB-P060`, `status: approved-for-acquisition`, assessed `public-domain`). The live path is **operator-run acceptance** — a real external fetch through the WAF-clearing browser + a real B2 write — so it is env-gated and NOT part of the hermetic suite (SC-005). To run the smoke:

```
export RUN_PAPERS_PAST_ACQUIRE=1
npx playwright install chrome            # once
# archive clone + B2 creds configured (COLONY_ARCHIVE_ROOT + ~/.config/backblaze/b2-credentials.txt)
npx vitest run tests/integration/repository/papers-past/acquire.test.ts
```

Smoke checklist (record the result here after the first real run):
- [ ] Scenario (a) image-CDN reachability: one real `/imageserver/...` URL returns valid GIF bytes via the stateless `HttpClient` — OR a challenge (then build the browser byte-fetch fallback per research R1).
- [ ] Scenario (b) `bib acquire PB-P061` → exit 0; N `page-master` GIFs held under `archive/papers-past/hns18840103.2.19.3/<sha256>.gif` in the archive clone + B2 with provenance; `bib show PB-P061` reflects the held assets; a second run is idempotent (0 duplicate object writes).

_Status: written + hermetic-tested in-session; the live smoke above is unrun (awaiting the operator's env-gated acceptance)._

## Scenario 7 — Unit suite is hermetic

`npx vitest run tests/unit/repository/papers-past` — all pass with injected fakes; 0 network calls; the real object store / host is never mutated (SC-005 / FR-015).
