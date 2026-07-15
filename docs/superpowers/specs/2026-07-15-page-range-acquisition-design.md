# Design: Page-range (excerpt) acquisition — `fetch-source --pages`

**Date:** 2026-07-15
**Status:** design (HOW, source of truth) — feeds the Spec Kit spec authored via the stack-control `define` front door.
**Motivating consumer:** PB-P054, the de Rays *Cour de cassation* arrêt — 3 pages (folios 48–50) inside a large Gallica serial fascicule (`bpt6k61587296`, *Bulletin des arrêts criminels* 1884) with no standalone ark.

## Problem

The shipped fetch pipeline acquires **whole documents**: `fetchMonograph`/`fetchIssue`
(`src/fetch/issue.ts`) resolve a document's `pageCount` and loop `for page in 1..pageCount`,
fetching every folio's IIIF master to B2 with a per-page provenance sidecar.

A court decision (or any excerpt) embedded in a large serial volume has **no standalone ark**
and is only a few pertinent pages of a fascicule otherwise full of unrelated material. Acquiring
it today forces mirroring the entire fascicule — the "acquire noise" antipattern
([[acquirable-is-not-pertinent]]): hundreds of off-topic pages to hold three.

We want to acquire **only the pertinent folios** (masters to B2 + provenance), reusing the
existing pipeline, with the excerpt's intended extent recorded honestly.

## Constraints inherited from the codebase

Fail-loud, no fallbacks/mock outside tests; no `any`/`as`/`@ts-ignore`; `@/` imports; files
≤ 300–500 lines; composition + DI; provenance mandatory; rights fail-closed; no git hooks.
Constitution principles I–X (see the active plan) apply unchanged.

## Key facts established during design

- The fetch core loops `for (let page = 1; page <= pageCount; page += 1)` at
  `src/fetch/issue.ts:239`; `pageCount = ctx.client.pagination(documentArk)` at :220.
- Provenance is **per-asset** (`src/model/provenance.ts`): each page image gets its own
  sidecar recording `issueArk` + the asset (folio) + rights + retrievedAt + tool. Excerpt
  provenance is therefore already page-granular and honest.
- `verifyIssueDir` (reconcile/verify) **re-hashes the files present** against their recorded
  checksums / B2 masters — there is **no "held == pagination count" gate** anywhere. A folio
  subset does not trip any completeness failure.
- `fetch-source` already gates on `sourceLayout(sourceId).kind`; PB-P054 is `kind: monograph`,
  so the document ark of the fascicule is fetched into PB-P054's monograph (flat) slug dir. The
  fact that Gallica *also* knows `bpt6k61587296` as a periodical issue is irrelevant to storage.

## Approach (chosen: minimal flag on `fetch-source`)

Constrain the existing per-page loop to a selected folio set. No new verb, no new Source kind,
no coverage/audit rework.

### 1. CLI surface

```
bib fetch-source <docArk> --source-id <id> --pages <spec> [--object-store] [--dry-run] [--ocr]
```

- `--pages <spec>` accepts inclusive ranges and/or comma lists: `48-50`, `48,50,52`,
  `48-50,55`. Parsed to a **deduplicated, ascending `number[]`** of IIIF folios.
- Numbers are **IIIF folios** (the fetcher's native unit — what the loop indexes), NOT printed
  page numbers. The pinpoint step (Gallica `ContentSearch` → `PAG_n`) supplies them.
- Omitting `--pages` = today's whole-document behavior, byte-for-byte unchanged.
- `--pages` is honored on the **monograph/document path only** (`fetch-source`); it is a usage
  error on the periodical `fetch-issue` path in v1 (out of scope).

### 2. Model

Add optional `folios?: number[]` to `RepositoryRecord` (`src/model/…`). It records the intended
holding so an excerpt is self-describing and a future `validate` check can assert
held == declared. Absent on whole-document records (unchanged). The CLI `--pages` value is the
fetch's source of truth; the field documents the committed intent and is what `reconcile`/audit
reference.

### 3. Fetch core

`fetchMonograph` / `fetchIssue` contexts gain an optional `folios?: number[]`. When present:

- Resolve `pageCount` as today (still used to bounds-check).
- Iterate the selected folios instead of `1..pageCount`; each is fetched as `f<NNN>` exactly as
  now, so filenames, checksums, object keys, and provenance keys are unchanged.
- **Fail loud** (no fallback) when: any requested folio `< 1` or `> pageCount`; the set is empty;
  or the range spec is malformed (non-integer, reversed `50-48`, stray tokens).
- `FetchIssueResult.pageCount` continues to mean the document's total; add
  `requestedFolios?: number[]` / `fetchedCount` to the result for an accurate summary line.

### 4. Provenance / archive

No schema change. Per-page sidecars already carry `issueArk` (the fascicule) + folio, so the
excerpt's provenance is complete and honest. The monograph flat dir holds just the selected
`f<NNN>.jpg` + sidecars.

### 5. Dry-run & reconcile

- `--dry-run --pages` estimates **only** the selected folios (scope `estimateIssue`/the sampled
  estimate to the requested set).
- `bib reconcile <id>` needs no change: it verifies present files against B2. With `folios`
  recorded, its summary can report "N/N declared folios in object store".

### 6. Completeness semantics

An excerpt is **complete when held folios == declared `folios`**, decoupled from `pageCount`.
No existing invariant enforces held == pageCount, so nothing must be relaxed; the new `folios`
field makes intended extent explicit for humans and future audit.

### 7. Correctness guard (consumer responsibility, not a fetcher feature)

Before committing masters, confirm the selected folios actually carry the target text. For
PB-P054, `ContentSearch` already grounds folios 48–50 in "…Dubreil de Rays…"; a spot OCR check
of the fetched pages confirms it. This lives in the acquisition runbook, not the fetcher.

## Testing

- **Range parser** (pure): `48-50` → `[48,49,50]`; `48,50` → `[48,50]`; `48-50,55` union;
  dedup; reject `50-48`, `0-3`, `` , non-integer, empty — each fail-loud with a clear message.
- **Fetch core** with injected fake client: asserts only the selected folios are fetched
  (byte-for-byte the same per-page pipeline); out-of-bounds folio fails loud; empty set fails
  loud; absent `folios` = unchanged whole-document behavior (regression).
- **Dry-run** estimate scoped to the requested folios.
- Reuse existing fake-runner/HTTP/object-store fixtures; no real network.

## Edge cases / fail-loud

- Folio `> pageCount` or `< 1` → throw (cannot fetch a non-existent folio).
- Reversed / malformed / empty range → throw at parse.
- `--pages` on `fetch-issue` → usage error (v1 monograph-path only).
- Overlapping tokens (`48-50,49`) → deduped to `[48,49,50]`, not an error.

## Out of scope (YAGNI)

`--pages` on the periodical path; logical-printed-page → folio mapping; a distinct `excerpt`
Source kind; coverage/audit surfaces for excerpts; multi-document excerpts.

## First consumer

Acquire PB-P054: `bib fetch-source bpt6k61587296 --source-id PB-P054 --pages 48-50 --object-store`
(folios confirmed via ContentSearch), then `bib reconcile PB-P054` → archived (3/3 declared
folios in B2). Advances PB-P054 from `to-collect` to `archived`.

## Front-door routing

This design record is the HOW source-of-truth. The Spec Kit spec (`specs/NNN-page-range-acquisition/`)
is authored via `/stack-control:define`, which drives `/speckit-specify` → `plan` → `tasks`,
then `/stack-control:execute`.
