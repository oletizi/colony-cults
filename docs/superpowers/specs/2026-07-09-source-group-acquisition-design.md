# Design: Source-Group Acquisition (`impl:feature/source-group-acquisition`)

- Date: 2026-07-09 (revised 2026-07-10 after third-party review)
- Roadmap item: `impl:feature/source-group-acquisition`
- Depends-on: `impl:feature/source-groups`, `impl:feature/gallica-fetcher` (both shipped);
  also builds on `canonical-source-metadata` (Source/Repository records) and
  `archive-object-store` (B2 storage), both shipped.
- Status: designing (awaiting operator approval) — revised per review, re-handed off.
- Backend: `superpowers:brainstorming` (frontend: `/stack-control:design`).

## Problem domain

`source-groups` (shipped) deliberately made **PB-P004** a `source-group` that
**cannot be fetched** — `fetch-source` throws *"is a Source Group — discover and
inventory its members, then fetch the members."* That was correct: PB-P004 is the
Marquis de Rays **legal corpus** (indictment, proceedings, sentencing, appeal,
government report), not one archival object. But it left PB-P004 with **no members**
and **no pipeline** to populate them. The blocked assets — the actual court records —
still need to be acquired. This feature builds that pipeline and runs it.

The design must stay consistent with two shipped architectural decisions this
feature touches directly (verified against `src/model/source.ts` and
`src/bibliography/vocab.ts`):

- **Opaque source IDs; membership is the `partOf` edge only.** The shipped primary
  key is a flat `PB-P###` / `PB-S###` id (`PB-P001`…`PB-P006`, `PB-S001/002`); the
  model comment states *"Group membership is derived from these edges (a group holds
  no member list)."* Identity is deliberately decoupled from organization.
- **Two disjoint lifecycle vocabularies.** A `Source`'s lifecycle
  (`discovered → approved-for-acquisition → excluded`) and a `RepositoryRecord`'s
  acquisition status (`wanted → to-collect → collecting → collected → archived`) are
  separate state machines; the model rejects a cross-domain value as a `vocab`
  validation error. A Source's lifecycle *ends* at `approved-for-acquisition`, where
  a RepositoryRecord's status *begins* (`wanted`/`to-collect`).

## Solution space

### Chosen — a reusable member pipeline (agent-assisted), proven on PB-P004

Implements the source-groups design's staged pipeline, reusable for any
source-group; the deliverable includes the actually-acquired PB-P004 corpus as the
end-to-end validation run. The stages, with **deterministic software checks
separated from research judgment**:

```
Discover → Inventory → Technical verification → Research approval (Promote) → Acquire → Preserve
```

1. **Discover (agent-assisted).** A session searches BnF/Gallica for candidate legal
   records (guidance queries: *marquis de Rays procès*, *du Breil de Rays procès*,
   *Port-Breton procès*, *cour d'assises*, …) and applies **relevance judgment** —
   original court record vs a later historical account. Software provides a search
   helper **over one documented mechanism selected by the spike** (below); the
   human/agent judges relevance.
2. **Inventory** — `inventory <ark> --group PB-P004 [--kind monograph]`: creates a
   member Source at the **next-free flat opaque id** (`PB-P007`, `PB-P008`, …) with
   `kind: monograph`, `partOf: PB-P004`, `status: discovered`. Membership is the
   `partOf` edge; the id carries **no** group prefix (see Decision 3). It also
   creates a `RepositoryRecord` (sourceArchive, ark, source_url, rights) at
   acquisition status **`wanted`** — not `to-collect`; acquisition state does not run
   ahead of research approval (see Decision 7). Inventory **preserves raw and
   normalized metadata** (Decision 5): the raw repository response, the normalized
   fields derived from it, `retrievedAt`, the endpoint used, and a normalization
   version; rights are stored as both `rightsRaw` (the archive's statement, evidence)
   and `rightsStatus` (the project's normalized determination).
3. **Technical verification** — `verify-member PB-P007`: **purely deterministic**
   software checks, no judgment. Confirms the repository identifier resolves
   (OAIRecord retrievable), normalized rights permit acquisition, required metadata
   is present, and it is not a duplicate (Decision 8). Emits a machine verdict; it
   does **not** decide corpus relevance.
4. **Research approval / Promote** — `promote PB-P007 --group PB-P004`: records the
   **researcher's judgment** that the item is a relevant member of the legal corpus,
   advancing the Source `discovered → approved-for-acquisition` and the
   RepositoryRecord `wanted → to-collect`. This is where "valid archival object" and
   "relevant member of this corpus" are kept distinct.
5. **Acquire** — reuses the **shipped fetcher**. The acquire step **resolves the ARK
   from the member's RepositoryRecord** and passes it to
   `fetch-source <ark> --source-id PB-P007 --object-store`, so the operator never
   supplies the ARK and the id together — the RepositoryRecord is the single source
   of truth (Decision 6). No new fetch code. (The source-groups guardrail blocks
   fetching PB-P004 *itself*, never its members.)
6. **Preserve** — provenance + manifest + B2, via the existing archive pipeline.

**Feature builds:** the reusable `inventory` / `verify-member` / `promote` commands
(+ a discovery search helper over one spike-selected mechanism) over the shipped
source-group model — works for any future source-group, not just PB-P004.

### Rejected — fully automated discovery

Gallica's web *search* (SRU on `gallica.bnf.fr`) tripped anti-bot protection when we
tried it during the fetcher work, and relevance ("original record vs later account")
needs judgment. Fully automated discovery is unreliable and would mis-file accounts
as records. Agent-assisted chosen.

### Rejected — curated-seed only

Acquire from operator-supplied ARKs only, no discovery. Simplest, but doesn't build
the discovery capability the corpus needs across its many future collections.

### Rejected — runtime discovery fallback chain (SRU → Playwright → OAI-PMH)

The prior revision floated a runtime fallback across mechanisms. **Rejected**: it
violates the project's fail-loud / no-fallback principle. A spike may *compare*
mechanisms, but the finished feature uses **one documented mechanism** and **fails
clearly** when it is unavailable — never silently degrading to another.

### Rejected — hierarchical member IDs (`PB-P004-00N`)

The prior revision assigned group-prefixed ids. **Rejected**: it re-couples identity
to organization, contradicting the shipped opaque-id decision, and misleads if a
document later belongs in another group or multiple research contexts. Membership is
the `partOf` edge; the id is flat and opaque.

## Decisions

1. Reusable **Discover → Inventory → Technical-verify → Research-approve → Acquire →
   Preserve** pipeline; **PB-P004 is the v1 validation run** and its acquired members
   are part of the deliverable.
2. **Agent-assisted discovery** — software helps search over **one** documented
   mechanism; a session judges relevance.
3. Members are ordinary Sources with **`partOf: PB-P004`** and **flat opaque IDs**
   (next-free `PB-P###`, e.g. `PB-P007`). Membership is the edge; the id carries no
   group prefix — consistent with the shipped `PB-P001` convention.
4. **Acquire reuses the shipped fetcher** with `--object-store` (B2); no new fetch
   code in v1.
5. **Technical verification is separated from research approval.** `verify-member`
   is deterministic (resolve, rights, dedup, required-fields); `promote` records the
   research judgment. The Source lifecycle gate (`approved-for-acquisition`) *is* the
   research-approval gate.
6. **Inventory preserves raw + normalized metadata** (raw response, `retrievedAt`,
   endpoint, normalization version; `rightsRaw` + `rightsStatus`). Raw is evidence;
   normalized is a project decision. *(Touches the `004-canonical-source-metadata`
   data model — see Open Questions; captured here, scoped separately.)*
7. **Source and RepositoryRecord statuses follow their separate vocabularies.** The
   RepositoryRecord is created at inventory as **`wanted`** and only advances to
   **`to-collect`** at `promote`; acquisition state never runs ahead of research
   approval.
8. **Duplicate detection distinguishes copy-level from work-level.** Same ARK within
   the same archive is a **hard duplicate**; matching normalized title/creator/date
   is a **possible duplicate requiring review**; a different repository copy of an
   existing work attaches a **new RepositoryRecord to the existing Source**, not a
   new Source (exactly what the Source/RepositoryRecord split supports).
9. **Acquire resolves the ARK from the RepositoryRecord** so the operator supplies
   only the source id — the RepositoryRecord is the single source of truth. Full
   metadata-driven fetcher resolution (`fetch-source PB-P007 --repository gallica`)
   is the **stated target**, out of v1 scope (it is new fetch code).
10. **Newspaper routing is a current modeling decision, not an absolute rule.** The
    shipped model permits only one `partOf` (`partOf?: string`, singular), so trial
    coverage that is a newspaper article routes to the **`PB-N###`** newspaper
    namespace rather than being a PB-P004 member. If multi-membership is ever
    modeled, revisit — evidence class (`kind`) and group membership (`partOf`) are
    orthogonal dimensions.
11. Fail loud, no fallbacks; only public-domain members get acquired.

## Open questions

_Carry into `/stack-control:define`; the scope decisions (marked ⟐) are for the
explicit operator-driven scoping pass, per capture-over-YAGNI. None are blockers to
authoring the spec — the spec sequences the discovery spike as its first gated task._

- **Discovery search mechanism (the crux)** — the spike selects **one** documented
  path and the feature commits to it, failing loud when unavailable. Lead candidate:
  the **BnF general-catalogue SRU** (`catalogue.bnf.fr` — documented bibliographic
  search, *distinct* from the anti-bot-blocked Gallica web search). Spike-time
  comparison candidates only: another documented BnF API, or explicitly
  manual/operator-supplied candidates. The spec must **not** promise a search helper
  until the spike proves its underlying service.
- ⟐ **Raw-metadata preservation → amendment to `004-canonical-source-metadata`.**
  Preserving raw response / endpoint / timestamp / normalization-version and
  `rightsRaw` adds fields to the canonical data model. Confirm whether this is an
  explicit amendment to 004 (recorded there) folded into v1, or deferred.
- ⟐ **Metadata-driven fetcher resolution → v1 or target-only.** Decision 9 keeps v1
  ARK-passed-internally (no fetcher change); the `--repository` target is new fetch
  code. Confirm it stays a named target vs. pulled into scope.
- **Candidate `ark:/12148/bpt6k5785971m`** (from the guidance) — verify it's an
  *original* court record vs a later account; may end `excluded` or route elsewhere.
- **Automation boundary** — how much of inventory/verify is OAIRecord-driven vs agent
  judgment; where the human confirmation gate belongs (now cleanly at `promote`).
- **Member kind** — legal records are mostly monographs; confirm none are serial.
- **ID allocation** — `PB-P###` numbers assigned next-free per the flat namespace;
  where the counter lives (scan existing `bibliography/sources/` for the max).

## Provenance

- Origin: interactive brainstorming session, 2026-07-09; decisions from operator
  answers (discovery approach, scope, member-ID scheme). Extends the third-party
  PB-P004 design guidance now that `source-groups` shipped.
- Revised 2026-07-10 after a third-party review, grounded against the shipped model.
  The review drove nine changes — the four that were *architectural corrections*
  (opaque IDs, separate status vocabularies, verify/promote split, duplicate
  identity rules) are confirmed by `src/model/source.ts` / `src/bibliography/vocab.ts`
  comments; the rest are refinements (remove runtime fallback; preserve raw
  metadata; single-source-of-truth acquire; newspaper reframe) and captured scope
  decisions.
- Grounded in the shipped model: `bibliography/sources/PB-P004.yml` (bare
  `source-group`; flat `PB-P001`…`PB-P006` neighbours), `src/model/source.ts`
  (`partOf`, opaque `sourceId`, dual lifecycle), `src/bibliography/vocab.ts`
  (`SOURCE_LIFECYCLE_STATUS_VALUES` vs `REPOSITORY_ACQUISITION_STATUS_VALUES`),
  `src/cli/fetch-source.ts` (`<ark> --source-id`, the guardrail).
- Resolves the PB-P004 "blocked assets" gap that `source-groups` intentionally created.
- Handoff target: `/stack-control:define`.
