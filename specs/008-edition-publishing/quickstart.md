# Quickstart: Edition Publishing

**Feature**: `specs/008-edition-publishing`

Runnable validation scenarios proving `pdf:publish` works end-to-end. Each maps to a User
Story / Success Criterion. Contracts: [`contracts/cli.md`](contracts/cli.md),
[`contracts/ssot-publications.md`](contracts/ssot-publications.md). Shapes:
[`data-model.md`](data-model.md).

## Prerequisites

- Built PDFs present: `npm run pdf:build -- PB-P001 --no-french` → `build/pdf/PB-P001/<issueId>.pdf`.
- Env: `COLONY_S3_BUCKET`, `COLONY_S3_ENDPOINT`, `COLONY_S3_REGION`, B2 credentials file,
  `CORPUS_CDN_BASE=https://colony-cults-cdn.oletizi.workers.dev`.
- Archive pin present: `site/data/archive-source.json` `.ref` non-empty.
- The source's affirmative rights determination authored (`rights: { status: public-domain, … }`).

Fast unit/integration validation (no network, no real B2) uses `FakeObjectStore`
(`tests/unit/archive/fake-object-store.ts`) + a temp SSOT dir — the primary way SC-003/SC-004/
SC-005 are proven. The scenarios below are the end-to-end shape.

---

## Scenario 1 — Publish a source's edition and record it (US1 / SC-001, SC-002)

```
npm run pdf:build -- PB-P001 --no-french
npm run pdf:publish -- PB-P001 --variant english-only --confirm
```

**Expect**:
- Each `build/pdf/PB-P001/<issueId>.pdf` uploaded to
  `editions/english-only/PB-P001/<issueId>__<snapshotShort>.pdf`.
- `bibliography/sources/PB-P001.yml` gains a `publications[]` entry (variant, publishedAt,
  snapshot, snapshotShort, cdnBase, keyScheme: versioned, rightsBasis, machineAssist, manifest).
- `bibliography/publications/PB-P001-english-only-<snapshotShort>.yml` lists every issue's
  `{issueId, key, url, sha256, pages}`.
- Console prints `published N` and the canonical CDN URLs.
- **Integrity (SC-002)**: `GET <recorded url>` returns bytes whose sha256 equals the recorded
  `sha256` for every issue.

## Scenario 2 — Rights gate refuses, fail-closed (US2 / SC-003)

```
# On a source with no affirmative rights (or rights.status not distributable):
npm run pdf:publish -- PB-XXXX --variant english-only --confirm
```

**Expect**: exit 1; message names the source and the missing/insufficient rights determination;
**nothing uploaded, nothing recorded**. Then author `rights: { status: public-domain, basis: … }`
and re-run → publish proceeds and records `rightsBasis` on the entry.

## Scenario 3 — Idempotent, immutable re-publish (US3 / SC-004, SC-005)

```
# Re-run with no rebuild:
npm run pdf:publish -- PB-P001 --variant english-only --confirm      # → zero uploads, SSOT unchanged (SC-004)

# Rebuild a changed edition (bump the pin, rebuild), then re-publish:
npm run pdf:publish -- PB-P001 --variant english-only --confirm      # → new <snapshotShort> key + new publications[] entry
```

**Expect**:
- Unchanged re-run: every key `SKIP` (`head` sha256 match), no `put`, `git status` shows no
  change to the SSOT or manifest (byte-identical re-serialize).
- Changed rebuild: a NEW versioned key + a NEW `publications[]` entry; **every previously
  published URL still resolves to its original bytes** (SC-005) — no overwrite, no purge.

## Scenario 4 — Reconcile the already-published 72 (US4 / SC-006)

```
npm run pdf:publish -- PB-P001 --variant english-only --reconcile --confirm
```

**Expect**: records the 72 at their existing legacy-flat keys
`editions/english-only/PB-P001/<issueId>.pdf` (no upload); a `publications[]` entry with
`keyScheme: legacy-flat` + a `…-legacy.yml` manifest; recorded URLs/sha256 match the served
artifacts (a `GET` of each recorded URL sha256-matches its manifest entry).

## Scenario 5 — Dry-run (no `--confirm`)

```
npm run pdf:publish -- PB-P001 --variant english-only
```

**Expect**: resolves, runs the rights gate, prints the planned keys/URLs and per-issue actions
(would-upload / would-skip), **writes nothing** to B2 or the SSOT (parity with
`site:export-public`'s refuse-without-confirm).

## Scenario 6 — Missing built PDF is attributable (Edge case / FR-011, G-7)

Delete one `build/pdf/PB-P001/<issueId>.pdf`, then publish.

**Expect**: that issue is NOT published; the run reports `FAIL PB-P001/<issueId>: no built PDF
at …`; the summary shows `failed 1`; exit 1. No partial/placeholder PDF is published.

## Verification checklist (for `superpowers:verification-before-completion`)

- [ ] `npm run typecheck` clean; `npm test` green (new `tests/unit/publish/**`).
- [ ] SC-003 refusal proven with `FakeObjectStore` asserting **zero `put`** on the refusal path.
- [ ] SC-004 proven: unchanged re-run → `put` count 0 and byte-identical SSOT/manifest.
- [ ] SC-005 proven: changed rebuild adds a new entry; the prior key's bytes are untouched.
- [ ] SC-006 proven: reconcile records legacy-flat URLs matching served artifacts.
- [ ] A real end-to-end publish of PB-P001 english-only drives the actual B2 + CDN (behind
      `--confirm`), and a recorded URL's fetched bytes sha256-match the manifest.
