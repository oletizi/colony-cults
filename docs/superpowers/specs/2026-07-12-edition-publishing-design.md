# Design: Edition Publishing (`impl:feature/edition-publishing`)

- Date: 2026-07-12
- Roadmap item: `impl:feature/edition-publishing`
- Depends-on: `impl:feature/corpus-print-pdf` (shipped — the PDF build layer + snapshot
  pin), `impl:feature/canonical-source-metadata` (closed — the Source / Repository-Record
  SSOT). Consumes the Cloudflare read-through CDN (`infra/cloudflare-cdn`) and the B2
  object store (`@/archive`).
- Status: designing (awaiting operator approval marker)
- Backend: `superpowers:brainstorming` via `/stack-control:design`; handoff to
  `/stack-control:define`.

## Problem domain

`corpus-print-pdf` (shipped) builds print-native facsimile-edition PDFs — one per
bibliographic item, in a `parallel` (FR OCR │ EN) or `english-only` reading variant.
Those PDFs were then published to the public Backblaze **B2** bucket (`colony-cults`),
fronted by the Cloudflare **read-through CDN** (`https://colony-cults-cdn.oletizi.workers.dev`),
using **ad-hoc shell / aws-cli scripts** (72 english-only PB-P001 issues).

Two gaps:

1. **No governed, repeatable publishing pipeline.** Distribution is a hand-run script,
   not a verb with fail-loud gates, idempotency, and provenance.
2. **Nothing in the canonical SSOT records that a published derivative edition exists.**
   The bibliography SSOT (`bibliography/sources/<id>.yml`) records the *source* (the
   intellectual work) and its `repositoryRecords[]` (other archives' copies — Gallica,
   SLQ). A **published PDF edition is a derivative WE made and host** — semantically
   distinct from both the source and the archived masters. A scholar cannot discover,
   cite, or verify a published edition from the metadata: there is no public URL, no
   PDF checksum, no publish date, no record of which pinned snapshot it was built from.

The corpus is 1880s colonial-scheme **propaganda held as evidence**; publishing is
governed by Constitution IV (respect copyright, **fail closed** — only lawfully
distributable / public-domain material). This feature also subsumes the "deliberate
public-domain export" that was deferred from `corpus-print-pdf` spec 007.

## Solution space

### Chosen — a `pdf:publish` verb over pre-built PDFs, recording per-edition into the Source SSOT

A CLI/npm verb (`pdf:publish`, sibling to `pdf:build` / `site:export-public` /
`site:snapshot`) that **operates over pre-built PDFs** (the `build/pdf/<source>/` output
of `pdf:build`), keeping building and distributing as separate, composable steps.

**Pipeline:**
1. Resolve the source + `--variant` (english-only | parallel) + the built-PDF directory.
2. **Rights gate — affirmative, fail-closed.** Assert the Source carries an *affirmative*
   rights determination (a controlled value, e.g. `rights: public-domain`). Refuse to
   publish anything whose rights are `likely`, absent, or non-distributable (Constitution
   IV). Consequence: PB-P001's current free-text `Public domain: likely` note must be
   upgraded to a structured affirmative determination before it can publish.
3. **Immutable versioned artifacts.** For each PDF: compute its sha256; upload to a
   versioned key `editions/<variant>/<source>/<issueId>__<snapshotShort>.pdf`
   (`snapshotShort` = the pinned archive-commit short the build came from) via
   `@/archive` `S3ObjectStore.put`. **Idempotent**: skip the upload when that exact key
   already carries that sha256. A changed re-build → a new versioned key → a new
   publication record; the old URL stays valid and citable, and **no CDN purge is ever
   needed** (sidesteps the `workers.dev` no-per-URL-purge limitation).
4. **Record into the SSOT.** Write a per-issue **manifest file** listing every issue's
   `{issueId, url, sha256, pages}`, and upsert a **`publications[]` entry on the Source**
   (`bibliography/sources/<id>.yml`): `{variant, publishedAt, snapshot, cdnBase,
   machineAssist, rightsBasis, manifest → path}`. The `publications[]` field is a NEW
   top-level field on `Source`, distinct from `repositoryRecords[]`; the source YAML
   stays lean because per-issue integrity lives in the manifest (mirroring the existing
   `repositoryRecords.manifest` pattern).
5. **Commit** the SSOT + manifest changes (provenance mandatory). Report the published
   count and the canonical CDN URLs.

**Reuse:** `@/archive` `S3ObjectStore` (put) + `resolveObjectStoreConfig`;
`@/archive/provenance` / `@/archive/checksum` (sha256); `@/bibliography` (SSOT
read/write); `@/model` (`Source`); the CDN infra + the corpus-print-pdf snapshot pin.
Fail-loud no-fallbacks; `@/` imports; no `any`/`as`/`@ts-ignore`; files ≤ 300–500 lines.

### Rejected — per-issue × variant records inline in the SSOT

Every published PDF (each issue × each variant) as its own explicit entry in
`bibliography/sources/<id>.yml` with url + sha256 + snapshot + variant. Fully
self-contained and maximally auditable in one file, but ~144 entries for PB-P001 alone;
the source YAML becomes large and noisy. Rejected in favour of the per-edition entry +
per-issue manifest (lean SSOT, integrity in the manifest).

### Rejected — a separate, decoupled publication registry file

A new top-level registry (`bibliography/publications/<id>.yml`) fully decoupled from the
Source, cross-linked by `sourceId`. Keeps the Source file clean, but splits a source's
provenance across two SSOT surfaces and adds a new top-level registry to keep coherent.
Rejected: the publication belongs *on* the source it derives from (one place to read a
source's full provenance). (Note: the manifest FILE still lives outside the source YAML —
but it is referenced from the source's `publications[]` entry, not a free-standing SSOT.)

### Rejected — `publish` builds then uploads (one verb)

A single verb that runs build → upload → record end to end. Fewer steps, but couples
building and distributing, re-builds on every publish, and mixes two concerns. Rejected
for the composable split (build, verify, then publish) — matching `site:snapshot` /
`site:export-public`.

### Rejected — stable URLs + `CACHE_VERSION` bump on change

Keep clean stable per-issue URLs; on a changed re-publish overwrite the B2 object and
bump the CDN `CACHE_VERSION` to invalidate globally. Nicest URLs, but re-publish needs a
manual cache-version flip and briefly serves stale content — bad for an integrity-critical
artifact. Rejected for immutable versioned artifacts (no purge, citation-stable).

## Decisions

1. **Publication record = per-edition entry on the `Source` (`publications[]`) + a
   per-issue manifest file.** New top-level field, distinct from `repositoryRecords[]`.
2. **`pdf:publish` operates over pre-built PDFs** (composable; separate from `pdf:build`).
3. **Rights gate is affirmative + fail-closed** — a controlled affirmative rights value on
   the Source is required; `likely`/absent/non-distributable is refused (Constitution IV).
4. **Immutable versioned artifacts** — versioned/content-addressed keys; re-build →
   new publication record, old URL stays valid; no CDN purge needed.
5. **Reuse** the shipped archive/object-store, provenance, bibliography, and CDN layers;
   fail-loud, typed, small modules.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Rights vocabulary + placement** — a top-level `Source.rights` field vs on the
  `RepositoryRecord`; the controlled vocabulary (e.g. `public-domain` | `openly-licensed`
  | ...) and how "likely" is migrated to an affirmative value.
- **Manifest file location** — `bibliography/publications/<id>-<variant>-<snapshotShort>.yml`
  vs `data/publications/...`; naming that stays stable across re-publishes.
- **Version token** — pinned snapshot-commit-short vs a monotonic edition version vs a
  PDF-sha prefix in the key.
- **CDN URL canonicalization** — the record stores the `workers.dev` origin today; a
  future custom domain (a real zone) would change the base. Record a stable alias / a
  base that survives the CDN move?
- **Publish scope** — PDFs only, or also the corpus-browser site's public PD text/image
  export (the original spec-007 deferral names both)?
- **Variant scope** — both `parallel` and `english-only` in v1, or english-only first?
  (Captured: both; scoping is a later operator pass.)
- **CDN warming** — should `publish` prime the CDN (GET each new key through the worker)
  as a final step so first public reads are HITs?
- **Reconciling the 72 already-hand-published english-only PDFs** — back-fill their
  publication records (they currently live at the *un*-versioned
  `editions/english-only/PB-P001/<issue>.pdf` keys), or re-publish them under the
  versioned scheme?

## Provenance

- Origin: interactive `/stack-control:design` (`superpowers:brainstorming`) session,
  2026-07-12, following the shipped `corpus-print-pdf`.
- Decisions 1–4 from operator answers to four `AskUserQuestion` prompts (record
  placement/granularity; build-vs-publish; rights gate; URL/re-publish semantics).
- Depends-on the shipped `corpus-print-pdf` (build layer + snapshot pin) and the closed
  `canonical-source-metadata` (SSOT); consumes `archive-object-store` (B2) and the
  Cloudflare CDN (`infra/cloudflare-cdn`, TASK-12).
- Motivating context: 72 english-only PB-P001 issues were hand-published to B2/CDN via
  ad-hoc scripts; this feature governs that path and records it in the SSOT.
- Handoff target: `/stack-control:define`.
