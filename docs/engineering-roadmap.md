---
doc-grammar: roadmap
---

# Roadmap

The governed dependency graph of this project's features. Each item is a
heading-keyed unit identified by its `<phase>:<kind>/<slug>` id.

Mutate the graph with `stackctl roadmap` verbs (run `stackctl roadmap --help`
for the full surface): `add` a new item, `advance` its status, `decompose`,
`reclassify`, `defer`, and `cluster` / `group` to gather existing items under a
created-or-reused parent. Example — cluster items under a new epic with a
dependency chain:

    stackctl roadmap cluster multi:feature/epic --children design:feature/a,impl:feature/b --chain --apply

For an edit that has no verb yet (e.g. moving a `part-of` / `depends-on` edge):
edit this file directly, then run `stackctl roadmap order` to revalidate the
graph (it fails loud on a cycle / dangling ref / duplicate id).

## impl:feature/gallica-fetcher
- status: shipped
- analyze-clean: yes
- spec: specs/001-gallica-fetcher
- design-approved: yes
- design: docs/superpowers/specs/2026-07-08-gallica-fetcher-design.md
Reusable TypeScript/tsx tool to fetch Gallica public-domain sources via documented web-service and IIIF APIs (Issues census, Pagination, IIIF images, OCR text) with provenance and checksums into the private archive; first target La Nouvelle France PB-P001

## impl:feature/source-translation
- status: in-flight
- design-approved: yes
- design: docs/superpowers/specs/2026-07-08-source-translation-design.md
- depends-on: impl:feature/gallica-fetcher
Mechanism to translate captured public-domain French sources (OCR text from the gallica-fetcher archive) to English for the research archive: machine-assisted translation retaining the original-language citation, labelled machine-assisted, with engine + date provenance, per AGENTS.md translation policy. First input: La Nouvelle France issue.txt OCR (PB-P001, public domain -> full translation committable).