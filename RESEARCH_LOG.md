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
