# AGENTS.md

This file defines how humans and AI agents should contribute to the `colony-cults` research project.

## Project role

This repository is a public digital humanities workspace. It should contain research metadata, bibliographies, notes, source summaries, schemas, timelines, and project management artifacts. It should not contain copyrighted scans or restricted source reproductions.

The companion private repository, `oletizi/colony-cults-archive`, is used for legally mirrorable digital assets and preservation metadata.

## Research standards

1. Prefer primary sources over secondary summaries.
2. Preserve disagreements between sources.
3. Record uncertainty explicitly.
4. Never convert speculation into fact.
5. Every factual claim should eventually cite a source ID.
6. Keep evidence and interpretation separate.

## Source IDs

Use stable source IDs.

- `PB-P###`: Port Breton primary source.
- `PB-S###`: Port Breton secondary source.
- `PB-N###`: Port Breton newspaper item.
- `PB-M###`: Port Breton map or visual source.
- `PB-A###`: Port Breton archival record.

Future cases should define their own prefixes.

## Copyright and acquisition policy

Mirror only material that is legally acquirable and preservable:

- public-domain material
- openly licensed material
- government publications where reusable
- archive material whose terms allow download/preservation

Do not mirror:

- copyrighted books
- restricted archival reproductions
- subscription database exports
- journal articles behind license restrictions
- full copyrighted translations

Copyrighted or restricted material may still be cataloged, summarized, and cited.

## Acquisition procedure (frugal, polite access)

External source repositories (Gallica, Trove, museum catalogues) have hair-trigger rate limits. Per Constitution Principle XII (Respect the Source), minimize requests and never make a request whose result is discarded. Do NOT use an estimate-only dry-run as a pre-flight — it pings the source, keeps nothing, then re-fetches for the real run. Never `curl` a rate-limited source; use the shipped rate-limited client.

The proven frugal acquire is TWO passes — download-and-keep, verify locally, upload only if good (proven end-to-end on PB-P054, the de Rays Cassation arrêt excerpt, 2026-07-16):

1. **Rights first (no image fetch).** The acquire gate reads the repository record's OAI-derived `rights` block, recorded at `inventory`. A hand-authored *lead* lacks it — populate from ONE `services/OAIRecord?ark=…` fetch and author `rights: {ark, status, rawResponse, dcRights, raw}` on the record. (`verify-member` only *checks* rights; it does not fetch them.)
2. **Pass 1 — download, keep, do NOT upload.** `npx tsx src/index.ts bib acquire <id>` **without** `--object-store` downloads page images to the local archive clone only. (Requires `COLONY_ARCHIVE_ROOT` + `COLONY_S3_*`; see the private per-session archive clone setup in `specs/009-corpus-gap-closure/quickstart.md`.)
3. **Verify locally (zero requests).** Open the downloaded `f<NNN>.jpg` and LOOK: right pages, complete (not cut off), legible. This catches a folio-vs-printed-page offset that unit tests cannot. For an excerpt, confirm the item starts and ends within the fetched folios.
4. **Pass 2 — upload only if good.** `bib acquire <id> --object-store` re-reads the local masters from cache and uploads to B2 with zero re-download ("from local cache", `0 B` downloaded).
5. **Reconcile.** `bib reconcile <id>` verifies masters in B2 and sets `archived`; an excerpt reports "N/N declared folio(s) in object store".

Reconnaissance (pinpointing an excerpt inside a large document) uses the narrowest bounded metadata calls — the Gallica Issues year-index + ContentSearch — never a whole-run census enumeration. Acquire only the pertinent excerpt, not the whole document (`bib fetch-source --pages` / `RepositoryRecord.folios`, spec 012).

## Metadata requirements

Every major source should include:

- source ID
- title
- creator/author/editor
- date or date range
- source type
- language
- archive/vendor/library
- catalog URL or stable identifier
- rights status
- acquisition status
- notes on reliability and bias

Every mirrored asset in the archive repo should also include:

- local path
- retrieval date
- original URL
- checksum
- file format
- OCR status

## File naming

Use lowercase kebab-case filenames.

Examples:

- `la-nouvelle-france.md`
- `baudouin-aventure-port-breton-1883.yml`
- `port-breton-timeline.md`

Avoid spaces and ambiguous abbreviations.

## Commit conventions

Use concise conventional-style commit messages:

- `docs: add source notes template`
- `research: add Port Breton open questions`
- `bibliography: add Baudouin source record`
- `archive: add metadata stub for La Nouvelle France`

## Handling translations

Machine translations may be used for research assistance, but:

- retain the original-language citation
- label translations as machine-assisted unless human reviewed
- do not commit full translations of copyrighted works
- quote sparingly and with page references

## Handling OCR

OCR is evidence-adjacent, not evidence itself. Keep original scans as the authority when available. Record OCR engine/tool, date generated, and known quality issues.

## Conflicting sources

When sources disagree:

1. Record both claims.
2. Attach source IDs to each claim.
3. Add a note describing the conflict.
4. Do not force resolution without evidence.

## Session workflow

At the beginning of a session, read:

- `PROJECT.md`
- `ROADMAP.md`
- `DECISIONS.md`
- `RESEARCH_LOG.md`

At the end of a session:

- update the research log
- update project status if needed
- leave clear next actions
