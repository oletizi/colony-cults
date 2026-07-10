# Design: Source-Group Acquisition (`impl:feature/source-group-acquisition`)

- Date: 2026-07-09
- Roadmap item: `impl:feature/source-group-acquisition`
- Depends-on: `impl:feature/source-groups`, `impl:feature/gallica-fetcher` (both shipped);
  also builds on `canonical-source-metadata` (Source/Repository records) and
  `archive-object-store` (B2 storage), both shipped.
- Status: designing (awaiting operator approval) — **handed off for a fresh session**
- Backend: `superpowers:brainstorming`.

## Problem domain

`source-groups` (shipped) deliberately made **PB-P004** a `source-group` that
**cannot be fetched** — `fetch-source` throws *"is a Source Group — discover and
inventory its members, then fetch the members."* That was correct: PB-P004 is the
Marquis de Rays **legal corpus** (indictment, proceedings, sentencing, appeal,
government report), not one archival object. But it left PB-P004 with **no members**
and **no pipeline** to populate them. The blocked assets — the actual court records —
still need to be acquired. This feature builds that pipeline and runs it.

## Solution space

### Chosen — a reusable member pipeline (agent-assisted), proven on PB-P004

Implements the source-groups design's **Discover → Inventory → Verify → Promote →
Acquire → Preserve**, reusable for any source-group; the deliverable includes the
actually-acquired PB-P004 corpus as the end-to-end validation run.

1. **Discover (agent-assisted).** A session searches BnF/Gallica for candidate legal
   records (guidance queries: *marquis de Rays procès*, *du Breil de Rays procès*,
   *Port-Breton procès*, *cour d'assises*, …) and applies **relevance judgment** —
   original court record vs a later historical account. (Software provides a search
   helper; the human/agent judges.)
2. **Inventory** — `inventory <ark> --group PB-P004 [--kind monograph]`: creates a
   member Source `bibliography/sources/PB-P004-00N.yml` — `kind: monograph`,
   `partOf: PB-P004`, `status: discovered` (the shipped source-lifecycle vocab),
   `titles`/`creator`/date pulled from **OAIRecord**, a `RepositoryRecord`
   (sourceArchive, ark, source_url, `dc:rights`, status `to-collect`), and a
   `relevance` note. Membership is the `partOf` edge; the namespaced ID
   (`PB-P004-00N`) is organizational.
3. **Verify** — `verify-member PB-P004-00N`: confirms the ARK resolves (OAIRecord),
   `dc:rights` is public-domain, and it is not a duplicate (same ark/title as another
   member); flags "candidate needs verification" cases for judgment.
4. **Promote** — `promote PB-P004-00N`: `discovered → approved-for-acquisition`.
5. **Acquire** — reuses the **shipped fetcher**: an approved member is a fetchable
   monograph, so `fetch-source <ark> --source-id PB-P004-00N --object-store` pulls
   page images → B2, OCR, provenance. (The source-groups guardrail blocks fetching
   PB-P004 *itself*, never its members.)
6. **Preserve** — provenance + manifest + B2, via the existing archive pipeline.

**Feature builds:** the reusable `inventory` / `verify-member` / `promote` commands
(+ a best-effort discovery search helper) over the shipped source-group model —
works for any future source-group, not just PB-P004.

### Rejected — fully automated discovery

Gallica's web *search* (SRU on `gallica.bnf.fr`) tripped anti-bot protection when we
tried it during the fetcher work, and relevance ("original record vs later account")
needs judgment. Fully automated discovery is unreliable and would mis-file accounts
as records. Agent-assisted chosen.

### Rejected — curated-seed only

Acquire from operator-supplied ARKs only, no discovery. Simplest, but doesn't build
the discovery capability the corpus needs across its many future collections.

## Decisions

1. Reusable **Discover→Inventory→Verify→Promote→Acquire** pipeline; **PB-P004 is the
   v1 validation run** and its acquired members are part of the deliverable.
2. **Agent-assisted discovery** — software helps search; a session judges relevance.
3. Members are ordinary Sources with **`partOf: PB-P004`**; **namespaced IDs
   `PB-P004-00N`** (organizational; membership is the edge).
4. **Acquire reuses the shipped fetcher** with `--object-store` (B2); no new fetch code.
5. **Newspaper** trial coverage routes to the **`PB-N###` series**, never a PB-P004
   member (per the source-groups design — different evidence class).
6. Fail loud, no fallbacks; only public-domain members get acquired.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Discovery search mechanism (the crux)** — spike to pick the reliable path:
  the **BnF general-catalogue SRU** (`catalogue.bnf.fr` — documented bibliographic
  search, *distinct* from the anti-bot-blocked Gallica web search) is the lead;
  fallbacks are the repo's **Playwright browser tooling** or **OAI-PMH**.
- **Candidate `ark:/12148/bpt6k5785971m`** (from the guidance) — verify it's an
  *original* court record vs a later account; may end `excluded` or route to another
  source.
- **Automation boundary** — how much of inventory/verify is OAIRecord-driven vs agent
  judgment; where a human confirmation gate belongs.
- **Member kind** — legal records are mostly monographs; confirm none are serial.
- **ID allocation** — how `PB-P004-00N` numbers are assigned (next-free per group)
  and where the counter lives.

## Provenance

- Origin: interactive brainstorming session, 2026-07-09; decisions from operator
  answers (discovery approach, scope, member-ID scheme). Extends the third-party
  PB-P004 design guidance now that `source-groups` shipped.
- Grounded in the shipped model: `bibliography/sources/PB-P004.yml` (bare
  `source-group`), `src/model/source.ts` (`partOf`), `src/bibliography/vocab.ts`
  (`SOURCE_LIFECYCLE_STATUS_VALUES`), `src/cli/fetch-source.ts` (the guardrail).
- Resolves the PB-P004 "blocked assets" gap that `source-groups` intentionally created.
- Handoff target: `/stack-control:define`.
