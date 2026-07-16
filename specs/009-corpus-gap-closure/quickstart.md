# Quickstart: run one corpus-gap-closure loop

Validates the program end-to-end on real state. The research *judgment* is human/agent; the commands are the touchpoints. Reuses shipped `bib` verbs; adds the adapter seam + search-log authoring.

## Prerequisites

- **Archive worktree + env.** The archive-root and object-store pointers are persisted in the gitignored project `.env`; load them once per shell instead of re-exporting by hand:
  ```
  set -a; source .env; set +a
  ```
  `.env` pins a DEDICATED archive worktree (a `colony-cults-archive` clone at `main`) reused across this operator's sequential sessions. Name it for the feature slug — `<feature-slug>-archive`, mirroring the code worktree's name (this feature: `corpus-gap-closure` ↔ `corpus-gap-closure-archive`). B2 secrets are NOT in `.env` — they live in `~/.config/backblaze/b2-credentials.txt`. If the pinned worktree is ever missing, re-clone under that name and update `COLONY_ARCHIVE_ROOT`:
  ```
  git clone --single-branch --branch main git@github.com:oletizi/colony-cults-archive.git \
    ~/work/colony-cults-work/<feature-slug>-archive
  ```
  Do NOT run two concurrent sessions against one worktree (the per-session policy, AGENTS.md §154 / TASK-19, guards concurrency — sequential reuse is safe).
- Baseline measure: `npx tsx src/index.ts bib coverage` (note the current `unexamined` dimensions).

## Track-1 (immediate, reused tooling — no new code)

1. **Reconcile already-acquired**:
   ```
   npx tsx src/index.ts bib reconcile PB-P003    # Baudouin book — masters in B2, status stale
   npx tsx src/index.ts bib reconcile PB-P001    # newspaper — partial → collected
   npx tsx src/index.ts bib validate
   ```
   Expect: PB-P003 → `archived`; PB-P001 → `collected`; `bib coverage` reflects them.
2. **Classify**: assign an evidence-class to each of the 13 sources (see data-model R2 seed list); re-run `bib coverage` — the `unclassified` count drops toward 0.

## The loop (per campaign × repository)

3. **Search-and-log** a repository for a campaign, then record it:
   ```
   # (adapter.search — automated where available, else the operator searches manually)
   # append a SearchLogRecord (repository, campaign, date, coverage, remaining-questions, outcome)
   npx tsx src/index.ts bib coverage    # PB-P004 × <repo> now appears with a date (was "(none)")
   ```
4. **Discover → inventory → verify → promote** each relevant candidate:
   ```
   npx tsx src/index.ts bib inventory <candidate ark/id> --source-group PB-P004 ...
   npx tsx src/index.ts bib verify-member <id>
   npx tsx src/index.ts bib promote <id>          # → approved-for-acquisition
   ```
5. **Acquire (any repository) + reconcile** each approved, public-domain member:
   ```
   npx tsx src/index.ts bib acquire <id> --object-store   # Gallica adapter today; Trove/… via new adapter
   npx tsx src/index.ts bib reconcile <id>                # SSOT → archived
   ```
6. **Re-measure + commit**:
   ```
   npx tsx src/index.ts bib coverage      # deltas: searches added, sources acquired, leads resolved
   git add bibliography/ && git commit -m "research(gap): <campaign> × <repo> pass — <deltas>" && git push
   ```
7. **Dry-round check**: after **2 consecutive dry rounds** for a repository × campaign, mark it searched-for-now (record the evidence); move to the next repository/campaign.

## Forward discovery

8. Mine an acquired source's bibliography/citations for new works → step 4. Resolve PB-P006's suspected New Italy items → identify (→ step 4) or document as unavailable with basis.

## Definition of done (measured, not zero)

The program is measured-closed for a campaign when: every surfaced lead is resolved-or-acquired (SC-004), every in-scope repository has ≥1 dated search-log entry (SC-001), every source is classified (SC-002) and every acquired source reconciled (SC-003), and every remaining not-fully-measured dimension is documented as `irreducible` with basis, with no `unexamined` left (SC-005). `bib coverage` shows no silently-empty dimension (SC-007).

## New-adapter path (when a source needs a non-Gallica repository)

Implement `RepositoryAdapter` (contracts/repository-adapter.md) for the repository (Trove first, for PB-P005): `search`, `resolveIdentifier` (fail loud), `determineRights` (fail closed), `acquire` (IIIF helper or bespoke). Add tests for the six INV-* invariants. Then run steps 3–6 through it.
