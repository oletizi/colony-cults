# Source Acquisition Workflow

This workflow governs how the project locates, evaluates, catalogs, and, when lawful, mirrors source material.

Use it for books, newspapers, pamphlets, maps, visual material, court records, archival items, museum records, and similar research sources.

## Core rules

- Evidence before narrative.
- Preserve provenance.
- Respect copyright.
- Copyright uncertainty blocks mirroring, not cataloging.
- The public repository records research state.
- The private archive repository stores only legally mirrorable assets and their preservation metadata.

## Repositories

### Public repository: `oletizi/colony-cults`

Use the public repository for:

- source IDs
- bibliographic metadata
- acquisition status
- catalog links
- source notes
- summaries
- research questions
- issue tracking

Relevant files include:

- `bibliography/sources.csv`
- `bibliography/acquisition-tracker.csv`
- `notes/source-notes-template.md`
- `research/`

### Private repository: `oletizi/colony-cults-archive`

Use the private archive repository only for assets that may be legally mirrored, plus preservation metadata for those assets.

Every mirrored asset should retain:

- local path
- retrieval date
- original URL
- checksum
- file format
- OCR status

## Workflow

### 1. Identify the source

- Confirm the source identity before doing anything else.
- Assign or confirm a stable source ID.
- Record the source in `bibliography/sources.csv` if it is not already present.
- Add or update the acquisition task in `bibliography/acquisition-tracker.csv`.

Minimum fields to confirm:

- title
- creator
- date or date range
- source type
- language
- current access path

### 2. Evaluate rights and access

Decide which of these cases applies:

- lawful to mirror
- lawful to catalog but not mirror
- uncertain

If rights are uncertain:

- do not mirror
- record the uncertainty
- keep working on cataloging, citation, and notes

Record:

- archive, library, vendor, or platform
- URL or catalog identifier
- rights status
- acquisition status
- any usage restrictions

### 3. Capture the public record

Update the public repository first so the discovery is not lost.

This usually means:

- `bibliography/sources.csv`: bibliographic record and status
- `bibliography/acquisition-tracker.csv`: next action and acquisition state
- a source note file based on `notes/source-notes-template.md` when the source is important enough to justify one

Public notes should distinguish:

- what the source is
- where it was found
- what it appears to contain
- what remains uncertain

### 4. Mirror only if permitted

If the source is lawful to mirror:

- store the asset in `oletizi/colony-cults-archive`
- record retrieval date and original URL
- generate and record a checksum
- record file format
- record OCR status if OCR is created

Do not put mirrored files in the public repository.

### 5. Create source notes

Create or update a source note when the source is central, difficult, disputed, or likely to be used repeatedly.

Each note should capture:

- access path
- rights status
- summary
- relevant people, places, ships, and events
- notable claims
- reliability and bias notes
- cross-references to related source IDs

Keep quotations short and cited by page, issue, or item reference.

### 6. Record acquisition outcomes

When the acquisition attempt is complete for the current step, update the tracker with the actual outcome:

- collected
- cataloged only
- blocked by rights
- blocked by missing scan
- blocked pending archive contact
- needs follow-up

Do not leave the next step implicit. Record the next concrete action.

### 7. Open or update an issue when needed

Use GitHub issues when the work needs durable coordination, follow-up, or conflict tracking.

Recommended templates:

- `Source acquisition`
- `Research task`
- `Source conflict`

Open an issue when:

- the source requires multi-step acquisition work
- rights are unclear
- multiple repositories or catalogs must be checked
- the source is important enough to track independently

## Decision rules

### Mirror

Mirror the source only when terms clearly allow preservation and local storage.

### Catalog only

Catalog without mirroring when the source is copyrighted, restricted, subscription-bound, or otherwise not clearly lawful to preserve locally.

### Escalate uncertainty

If rights, identity, edition, or provenance are ambiguous, record the ambiguity explicitly and leave the source in a non-mirrored state until clarified.

## Preferred order of work

1. Confirm identity.
2. Record the public metadata.
3. Evaluate rights.
4. Mirror in the private archive only if allowed.
5. Write notes and cross-references.
6. Leave the next action in the tracker or an issue.

## Definition of done for one acquisition step

An acquisition step is complete when:

- the public repository reflects what was found
- the rights state is recorded
- the next action is explicit
- any lawful mirrored asset has provenance metadata and a checksum
- important uncertainty is written down
