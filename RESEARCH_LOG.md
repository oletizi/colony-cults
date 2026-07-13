# Research Log

## 2026-07-07

### Summary

Initialized the long-term project structure for the Colony Cults research archive.

### Completed

- Created public research repository structure.
- Added initial README, bibliography, acquisition tracker, and source notes template.
- Added Port Breton starter files for people, places, ships, timeline, and open questions.
- Created private archive repository for preservation copies of legally mirrorable assets.
- Added archive README, acquisition register, and metadata stubs for core Port Breton sources.
- Added project dashboard, roadmap, and agent contribution guide.

### Current focus

Milestone 1: Project Infrastructure.

### Next actions

- Add decision log.
- Add issue templates.
- Locate direct download path for *La Nouvelle France*.
- Verify Baudouin 1883 Gallica record.
- Locate Paul de Groote promotional book scan.

### Notes

The repository should be treated as the project memory. Future sessions should begin by reading the project dashboard, roadmap, and research log.

## 2026-07-07 - Governance principles captured

### Added operating principle

Commit early. Commit often. Push frequently.

Uncommitted work is temporary. Committed work is durable. Pushed work is recoverable. It is safer to commit and push a small imperfect change and roll it back later than to leave valuable work trapped in memory, a browser tab, a local scratch file, or a chat transcript.

### Related principles

- The repository is the project's memory.
- The project must survive a complete context wipe.
- Optimize for durable commits, not chat responses.
- Never make the same discovery twice.
- Leave the project in a better state than it was found.

### Implementation note

These principles were later promoted into dedicated governance files in the same day's follow-up session.

## 2026-07-07 - Governance files created

### Summary

Created the repository governance layer so session continuity and project state no longer depend on chat context alone.

### Completed

- Added `GOVERNANCE.md`.
- Added root `DECISIONS.md`.
- Added governance charter, start, end, next-actions, state, checklist, and governance-decision files under `governance/`.
- Updated the roadmap to reflect that the decision log, research log, and governance files now exist.
- Pushed the governance work in small coherent commits.

### Current focus

Milestone 1: Project Infrastructure.

### Next actions

- Add issue templates.
- Document the source acquisition workflow.
- Begin Milestone 2 work on `La Nouvelle France`.

### Notes

The repository now contains an explicit governance layer for startup, shutdown, state recovery, and next-session handoff.

## 2026-07-07 - Session ceremony invocation clarified

### Summary

Clarified how to run session-start and session-end ceremonies in a repository that is not yet using stack-control.

### Completed

- Confirmed that session ceremonies are invoked manually through repository governance files.
- Recorded the direct invocation pattern: `run session start` and `run session end`.
- Refreshed `governance/STATE.yaml` so current focus now reflects the remaining infrastructure work rather than the completed governance setup.

### Current focus

Milestone 1: Project Infrastructure.

### Next actions

- Add issue templates.
- Document the source acquisition workflow.
- Begin Milestone 2 work on `La Nouvelle France`.

### Notes

For now, the ceremony is file-driven rather than tool-driven: start by reading repo state, end by writing repo state back and pushing it.

## 2026-07-07 - Issue templates added

### Summary

Added GitHub issue templates tailored to the repository's research workflow.

### Completed

- Kept the existing source acquisition template.
- Added a research task template.
- Added a source conflict template.
- Added issue template configuration to steer contributors toward governed issue creation.
- Updated roadmap and governance state to reflect that issue templates are now complete.

### Current focus

Milestone 1: Project Infrastructure.

### Next actions

- Document the source acquisition workflow.
- Open the first acquisition issues for core Port Breton sources.
- Begin Milestone 2 work with `La Nouvelle France`.

### Notes

The remaining Phase 1 gap is now workflow documentation rather than GitHub issue structure.

## 2026-07-07 - Source acquisition workflow documented

### Summary

Documented the acquisition workflow that connects public research tracking to private lawful mirroring.

### Completed

- Added `notes/source-acquisition-workflow.md`.
- Defined the public/private repository split for source intake.
- Documented the sequence for source identification, rights evaluation, cataloging, mirroring, note creation, and issue tracking.
- Updated the README repository structure to include the workflow document.
- Refreshed governance state so the next work now points at the first concrete acquisition issues rather than missing process documentation.

### Current focus

Milestone 1: Project Infrastructure, transitioning into Milestone 2 preparation.

### Next actions

- Open the first acquisition issue for `La Nouvelle France`.
- Begin Milestone 2 source acquisition work.
- Use the new workflow document as the default intake path.

### Notes

The repository now has an explicit intake process for deciding what is cataloged publicly, what may be mirrored privately, and how provenance is preserved across both.

## 2026-07-07 - First acquisition issue opened

### Summary

Started Milestone 2 execution by opening the first source acquisition issue for `La Nouvelle France`.

### Completed

- Created GitHub issue `#1`: `Acquire: La Nouvelle France (PB-P001)`.
- Updated `bibliography/acquisition-tracker.csv` so `PB-P001` now points to the live issue and is marked in progress.
- Refreshed governance state so current work is centered on rights review and run discovery for `La Nouvelle France`.

### Current focus

Milestone 2 startup through `PB-P001`.

### Next actions

- Search for the best available digitized run of `La Nouvelle France`.
- Verify whether any discovered copy may be lawfully mirrored in the private archive.
- Open follow-on acquisition issues for other core Port Breton sources.

### Notes

This is the first live test of the repository's documented acquisition workflow and issue structure.

## 2026-07-07 - La Nouvelle France access points confirmed

### Summary

Confirmed the first concrete digital access points for `PB-P001` and narrowed the next rights-review step.

### Completed

- Confirmed that State Library of Queensland reports two bound digitized volumes covering 1879-1881.
- Confirmed Gallica issue-level access, with at least the 15 July 1879 issue verified.
- Added a dedicated source note: `notes/la-nouvelle-france.md`.
- Added the finding back to GitHub issue `#1` and sharpened the acquisition tracker next action.

### Current focus

Milestone 2 acquisition work on `PB-P001`.

### Next actions

- Compare SLQ and Gallica holdings for completeness.
- Check record-level rights or download statements before mirroring any files.
- Keep the public repo in link-and-catalog mode until mirror rights are explicit.

### Notes

The underlying newspaper is likely public domain by age, but the archive decision still depends on the host institutions' terms for the digitized copies we can access.

## 2026-07-07 - La Nouvelle France host-rights split clarified

### Summary

Clarified the difference between Gallica's item-level public-domain signal and SLQ's more general host-level reuse guidance.

### Completed

- Recorded that the verified Gallica issue is labeled `domaine public` in page metadata.
- Recorded that SLQ's publicly visible rights guidance is broader and still needs item-level confirmation before mirroring.
- Updated the acquisition tracker to prioritize Gallica for mirror-rights review while keeping SLQ in link-and-catalog mode.

### Current focus

Milestone 2 acquisition work on `PB-P001`.

### Next actions

- Compare SLQ's two bound volumes against Gallica's issue-level availability.
- If Gallica continues to expose public-domain issue records, use that path as the leading archive candidate.
- Treat SLQ as access-confirmed but mirror-unverified until the item record says more.

### Notes

This is a useful governance test: the repo now preserves not just a rights conclusion, but the distinction between host-specific evidence levels.

## 2026-07-07 - La Nouvelle France minimum coverage picture improved

### Summary

Moved `PB-P001` from vague access notes toward a minimum verified holdings picture.

### Completed

- Recorded that SLQ explicitly shows `Volume 1` issues `1-10`.
- Recorded that SLQ also shows `Volume 2` examples from issues `13`, `20`, and `21`.
- Recorded search-visible Gallica issue pages for `1879-07-15`, `1879-12-15`, and `1881-08-15`.
- Recorded an external catalogue note that mentions a `15 June 1879` specimen issue and `No. 1` beginning in July 1879.

### Current focus

Milestone 2 acquisition work on `PB-P001`.

### Next actions

- Turn the minimum verified coverage into an exact issue census.
- Keep Gallica as the leading mirror-rights candidate.
- Use SLQ as a coverage comparator until item-level reuse terms are clearer.

### Notes

The repo now distinguishes between a complete holdings claim, which we do not yet have, and a minimum verified span, which we do.

## 2026-07-07 - La Nouvelle France issue endpoints captured

### Summary

Converted part of the minimum coverage picture into stable issue-level identifiers.

### Completed

- Recorded verified Gallica issue endpoints for `1879-07-15`, `1879-12-15`, and `1881-08-15`.
- Refined the tracker so the next action is to extend that verified issue list rather than restate the same broad coverage claim.

### Current focus

Milestone 2 acquisition work on `PB-P001`.

### Next actions

- Find additional verified issue endpoints between the current start and end dates.
- Keep distinguishing exact issue evidence from inferred run completeness.
- Continue using Gallica as the lead candidate for archive review.

### Notes

Stable issue endpoints make the next pass cheaper: we can now add to a growing census instead of restarting discovery from the title level each time.

## 2026-07-07 - Additional 1879 Gallica issue confirmed

### Summary

Added another late-1879 Gallica issue endpoint to the growing verified census.

### Completed

- Confirmed and recorded `1879-11-15` as `ark:/12148/bpt6k5606843t`.
- Updated the tracker and source note so the verified issue list now has four concrete Gallica anchors.

### Current focus

Milestone 2 acquisition work on `PB-P001`.

### Next actions

- Keep extending the verified issue list between November 1879 and August 1881.
- Use the denser 1879 cluster to test whether Gallica's run is monthly, near-monthly, or incomplete.

### Notes

Even one additional verified issue matters here because it starts to reveal the cadence of surviving online fascicles.

## 2026-07-07 - 1880 Gallica cluster and SLQ identifiers captured

### Summary

Extended the verified `PB-P001` census into early 1880 and captured the stable SLQ title-level identifiers that were still reachable despite catalogue rendering barriers.

### Completed

- Confirmed and recorded `1880-02-15` as `ark:/12148/bpt6k56068462`.
- Confirmed and recorded `1880-03-15` as `ark:/12148/bpt6k5606847g`.
- Confirmed and recorded `1880-04-15` as `ark:/12148/bpt6k5606848w`.
- Captured the SLQ One Search permalink, library system id `slq_alma99183978086302061`, call number `RBS 919.5 004`, and direct delivery URL exposed through Queensland open data.

### Current focus

Milestone 2 acquisition work on `PB-P001`.

### Next actions

- Consolidate the verified census and decide whether the remaining gaps are worth a future manual browser session.
- Treat direct Gallica run extraction and richer SLQ catalogue parsing as currently blocked rather than merely unfinished.
- Move parallel acquisition work forward on other core sources while retaining the current `PB-P001` evidence set.

### Notes

The verified Gallica list now forms a meaningful cluster from November 1879 through April 1880, plus an August 1881 anchor, but it is still not a complete run.

## 2026-07-07 - PB-P001 inquiry substantially exhausted

### Summary

Reached the point where the remaining `La Nouvelle France` gaps are mostly host-interface and anti-bot constraints rather than missed straightforward discovery paths.

### Completed

- Documented the blocked-state of direct Gallica search and SRU access.
- Documented that SLQ's JavaScript-heavy catalogue remained difficult to parse directly, even though stable identifiers were recovered by other means.
- Documented that the expected local Playwright wrapper was not present, limiting automated browser follow-up in this environment.

### Current focus

Milestone 2 acquisition work on `PB-P001`, with the easy discovery routes now largely exhausted.

### Next actions

- Preserve the blocked-state knowledge in the repo and issue thread.
- Decide later whether a higher-friction manual browser session is justified.
- In the meantime, keep project momentum by advancing parallel source acquisition work.

### Notes

This closes the current easy-to-medium inquiry loop on `PB-P001` without pretending the run is complete.

## 2026-07-07 - Browser tooling path restored

### Summary

Resolved the browser-automation tooling blocker by adding and validating a repo-local Playwright CLI wrapper.

### Completed

- Added `scripts/playwright-cli.sh` as a repo-local fallback to `npx @playwright/cli`.
- Added `notes/browser-tooling.md` documenting the workflow and why the fallback exists.
- Installed a usable Playwright Chromium browser in the environment.
- Validated `open`, `snapshot`, and `requests` through the repo-local wrapper against `https://example.com`.

### Current focus

Tooling blocker removed; browser-based follow-up is now available when needed.

### Next actions

- Use the repo-local wrapper for future Gallica or SLQ browser sessions.
- Re-open `PB-P001` only when a manual browser pass is worth the remaining friction.
- Continue parallel source acquisition work with the tooling gap now closed.

### Notes

The original blocker was not lack of Playwright itself, but the absence of the expected wrapper path. The repo now owns a stable fallback.

## 2026-07-07 - Gallica serial run page reached in browser

### Summary

Used the restored browser tooling to break past the static discovery ceiling on `PB-P001`.

### Completed

- Reached Gallica's live search UI and navigated from search results to the serial run page for `La Nouvelle France (Marseille)`.
- Confirmed the Gallica serial page `https://gallica.bnf.fr/ark:/12148/cb328261098/date`.
- Recorded Gallica's year-level run counts: `1879` 6, `1880` 8, `1881` 8, `1882` 12, `1883` 21, `1884` 13, `1885` 10.
- Identified a substantive run-length conflict between Gallica's `1879-1885` serial page and the narrower SLQ-based picture.
- Opened GitHub issue `#2`: `Conflict: La Nouvelle France run length`.

### Current focus

Milestone 2 acquisition work on `PB-P001`, now with browser-based Gallica access proven.

### Next actions

- Extract exact issue dates from the yearly Gallica pages.
- Preserve the `1879-1885` vs `1879-1881/1882` conflict explicitly.
- Keep the verified issue-endpoint list growing from the live serial page.

### Notes

This is the most important `PB-P001` breakthrough so far because it upgrades the inquiry from scattered issue hits to a host-confirmed serial run structure.

## 2026-07-07 - PB-P001 browser follow-up reached host-instability limit

### Summary

Tried to push beyond year-level counts into exact per-issue dates through the live Gallica year pages, but hit intermittent access instability.

### Completed

- Confirmed that the browser route can reach the serial run page and expose year-level counts.
- Confirmed that repeated direct navigation to year pages such as `date1879` can still fall back to `403 Access Interdit`.
- Preserved that intermittent blocked-state in the source note and acquisition tracker.

### Current focus

`PB-P001` now has a materially improved run structure, but exact issue-by-issue extraction remains host-limited.

### Next actions

- Treat the current Gallica run structure and verified issue endpoints as the durable stopping point for now.
- Resume only if a future manual session can tolerate intermittent blocking or if another host provides cleaner per-issue metadata.
- Advance parallel source work instead of grinding the same unstable interface.

### Notes

This is a different class of stop than earlier: the tooling blocker is solved, but the host itself is now the limiting factor.

## 2026-07-08 - Manual check list added for PB-P001

### Summary

Added a repo-local checklist for hand-reviewing the remaining `La Nouvelle France` pages.

### Completed

- Added `notes/la-nouvelle-france-hand-check-list.md`.
- Captured the Gallica, SLQ, and comparator URLs most worth checking manually.
- Structured the list around concrete verification tasks rather than open-ended browsing.

### Current focus

`PB-P001` remains ready for manual browser follow-up if needed.

### Next actions

- Use the checklist during any future manual review session.
- Record any hand-confirmed issue dates or rights statements back into `notes/la-nouvelle-france.md`.

### Notes

The checklist is meant to reduce repeated orientation work when the remaining gaps are best handled by a human browser pass.

## 2026-07-13 - Corpus gap-closure: baseline + Phase-2 reconcile (spec 009)

### Summary

First measured pass of the reshaped (research-first) corpus-gap-closure program. Captured the pre-program baseline, then reconciled the two already-acquired sources into the SSOT using only the shipped `bib reconcile` verb — zero new code.

### Baseline (pre-program measured gap)

- Campaign PB-P004: 5 members (approved-for-acquisition); believed extent `unknown`.
- Campaign PB-P006: 0 members; extent `unknown`; 2 suspected New Italy Museum leads (photographs, survivor accounts) with rights basis recorded.
- Evidence classes: 13 unclassified (all sources).
- Search history: empty (no repository × campaign logged).

### Completed

- **T011** — `bib reconcile PB-P003` (Baudouin 1883 book) → `archived` (395/395 masters in object store).
- **T012** — `bib reconcile PB-P001 --archive "Gallica / BnF"` (La Nouvelle France) → `archived` (985/985 masters). The State Library of Queensland copy correctly stays a separate `to-collect` RepositoryRecord (single-work-once holds).
- `bib regenerate` resynced the generated `acquisition-tracker.csv` view; `bib validate` clean.

### Findings (fed back to the spec's assumptions)

- The real prerequisite was **not** more code but the **per-session archive clone** — `bib reconcile` reads page-image provenance from `COLONY_ARCHIVE_ROOT` (a clone of the private `colony-cults-archive` repo; masters in B2). With no clone it failed loud ("nothing acquired to reconcile"); with the clone it advanced cleanly. This is exactly the research-first thesis: the loop surfaced the actual need (env/clone setup, tasks.md T002), not a speculative tool.
- **PB-P001 was fully archived, not partial** — the task predicted `collected`; provenance showed all 985 Gallica masters present, so `archived` is the honest result. The task's "partial" premise was stale; the tool did the provenance-driven right thing.
- `bib reconcile` fails loud on an ambiguous multi-copy source (requires `--archive`) — correct, no silent guess.

### Next actions

- Continue the loop: classify the 13 sources (US5) and begin search-and-log (US1). Pull tooling (search-log authoring / evidence-class facet) only if hand-authoring proves repetitive.

### Notes

Per-session archive clone lives at `session-558a1445-archive` (not the shared honey-pot path); `COLONY_ARCHIVE_ROOT` + B2 env exported per quickstart.

## 2026-07-13 - Corpus gap-closure: evidence-class pass (US5)

### Summary

Classified the 11 individual works by genre (hand-edited `evidenceClass` on each source yml — no new tool needed). `unclassified` 13 → 2.

### Completed

- **T021 (partial)** — evidence-class assigned by document genre: newspaper ×2 (PB-P001 propaganda paper, PB-P005 Australian coverage), book ×3 (PB-P003 Baudouin, PB-S001 modern monograph, PB-S002 Phantom Paradise), prospectus ×2 (PB-P002 settler promotional, PB-P009 subscription-closing notice), pamphlet ×2 (PB-P010 rebuttal to ministerial circular, PB-P011 published lecture), trial-record ×2 (PB-P007 judgment-stenography extract, PB-P008 appeal pleading).
- `bib regenerate` + `bib validate` clean.

### Findings (captured to backlog)

- **The coverage evidence-class distribution counts source-groups (containers) as works.** The remaining `unclassified 2` are the two source-groups PB-P004 (5 members, all already classified individually) and PB-P006 (empty). SC-002 ("unclassified → empty") cannot be honestly met by classifying a heterogeneous container — the coverage model should count works, not containers (or exclude containers from the distribution). Refines SC-002.
- **The shipped evidence-class vocab is narrower than the spec's R2 seed** — `EVIDENCE_CLASS_VALUES` = book/pamphlet/prospectus/newspaper/trial-record/gov-report/map/correspondence/periodical-article. It lacks `survivor-account` / `photograph` / `memoir`, which PB-P006's suspected New Italy items will need once inventoried. Not blocking yet (P006 has no members); extend the (closed-but-extensible) vocab when those members land.
- Genre-vs-grouping observation: PB-P009/P010/P011 are de Rays's own promotional/defence writings yet sit under PB-P004 ("trial and legal proceedings"). Classified by genre (prospectus/pamphlet), not by group; grouping left as-is.

### Next actions

- Begin US1 search-and-log (turn the empty search history into measured coverage), or resolve PB-P006 suspected leads (US4). Pull the search-log authoring tool only if hand-authoring records proves repetitive.
