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
