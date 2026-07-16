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

**Reaching a deflected source.** When a source's CDN has deflected this environment's IP (e.g. Gallica/BnF returning 403), shifting the Tailscale exit node (`tailscale set --exit-node=<node>`, a France node for BnF) presents a fresh public IP with a SHORT grace window. That grace is a scarce, shared lever — plan the full batch of URLs first, run them in ONE economical polite pass (still through the shipped rate-limited client, never `curl`), and never abuse it. **Every fetched response is precious: write each raw body to disk (the committed `bibliography/repository-responses/` provenance store) BEFORE parsing, then run all analysis/greps offline against the saved files.** Never re-fetch a source to re-grep a response you already fetched and discarded — a parsing miss must cost zero additional requests.

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

## Curatorial scope (pertinence before acquirability)

The corpus is about **Port Breton** — the Marquis de Rays expedition and the affair itself (recruitment, voyage, the PNG colony, its collapse, the survivors' arrival) and its **first-generation participants**. It is NOT about **New Italy**, the NSW settlement the survivors founded afterward, nor its second-generation descendants, community life, farms, weddings, school groups — those are corpus-**adjacent**, not central.

Judge **pertinence (a curatorial call) before acquirability.** A rights-clearable pre-1955 photo of a school group is acquirable but adjacent; a survivor's first-hand account of the voyage is central. A mechanical filter (e.g. Australian + photograph + pre-1955) selects for rights-clearability, not corpus-centrality — never mass-acquire on such a filter alone. Here the *died-before-1955* line ≈ the *first-generation-participant* line. Preserve-and-mark out-of-scope material with `Source.centrality: adjacent` (coverage counts it separately); do NOT delete it on your own scope inference.

## Engineering conventions

- **Clean breaks, no back-compat.** When changing a schema/format/interface, do a single clean cutover: rewrite existing data to the new canonical shape and make every loader/consumer speak ONLY the new shape, **failing loud on the old one** (an old key becomes an error, never a tolerated alias). Do NOT stand up transitional dual-representations or "accept both for now" shims — back-compat is tech debt that lures later work onto the soon-to-be-removed shape.
- **Fix tooling inline.** When a bounded tooling defect surfaces mid-work and you already hold the context, fix it (verify + commit + push) rather than only capturing it to the backlog — re-loading the context later is the expensive part. If a "fix" balloons past a clean bounded change, surface it instead of sprawling.
- **No private agent memory.** Constitution XIII: never record project knowledge in a private per-machine agent-memory store. This repository IS the project memory (see `GOVERNANCE.md`); durable knowledge goes here.

## Spec-driven workflow (stack-control front door)

- Features flow through the stack-control front door: **design → define → execute → ship** (Constitution VIII), over raw Spec Kit.
- Branch/spec-dir convention: work stays on a **`feature/<slug>`** git branch paired with an **independently-numbered spec dir** (`specs/NNN-<slug>/`). Do NOT run the Spec Kit `speckit.git.feature` branch hook (it would mint a new numbered branch and switch off the design-bearing branch). `.specify/feature.json` — not the branch name — resolves the active spec; Spec Kit's `check-prerequisites.sh` rejecting the `feature/<slug>` name is the expected TF-09 condition, non-blocking.
- Bracket every `/speckit-*` backend drive with `stackctl front-door enter/exit` (capabilities `spec-definition` / `spec-execution`); carry the literal token between the two separate shell calls. At the `/speckit-tasks` seam inject the tier-requirement block from `stackctl tier-vocab`. For an existing roadmap node, set its spec pointer with `stackctl workflow link-spec <id> specs/NNN-<slug> --apply`.
- **Govern step:** if `stackctl govern --mode implement` (the end-of-execute cross-model audit-barrage) does not converge in the current environment, read the findings from the run dirs under `.stack-control/audit-runs/*/`, fix every HIGH finding, validate the feature LIVE end-to-end, then record an explicit `stackctl govern --mode implement --item <id> --override "<reason>"` documenting the live validation + fixes. Do not silently lower the fleet floor.

## Archive worktree (dedicated, sequential — never a shared concurrent tree)

The archive is a clone of `git@github.com:oletizi/colony-cults-archive.git` (`--single-branch --branch main`, ~14 MB — page-image masters live in B2, not git). A **dedicated worktree**, named for the feature slug (`<feature-slug>-archive`, mirroring the code worktree — this feature: `corpus-gap-closure` ↔ `corpus-gap-closure-archive`), is pinned in the gitignored project `.env` (`COLONY_ARCHIVE_ROOT` + the `COLONY_S3_*` pointers); load it with `set -a; source .env; set +a` instead of re-exporting each session. Reusing one dedicated worktree across this operator's **sequential** sessions is safe and is the intended workflow — the hazard the policy guards is **concurrency**: NEVER run two sessions against one working tree at once (non-fast-forward pushes, add/add conflicts, `--checkpoint` add-all sweeping the other session's files). Keep the pinned worktree clean and synced with `origin/main`. B2 is the single shared asset store; the git working tree must not be. Full setup recipe: `specs/009-corpus-gap-closure/quickstart.md`.

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
