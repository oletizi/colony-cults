---
slug: 015-english-source-pdf
targetVersion: ""
---

# Audit log — 015-english-source-pdf

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-01 — Colophon OCR-quality caveat is sampled only from the lead folio, so a mixed-quality edition can disclose "clean" while carrying sub-high pages

Finding-ID: AUDIT-20260719-01 (claude-04 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=low, codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/pdf/load/archive-edition.ts (`buildOcrTranscription(leadProvenance, context)`; `deriveOcrCaveat`)

`deriveOcrCaveat` derives the FR-009 sub-high caveat from a single folio's `ocr_quality.tier`, and the reader feeds it `leadProvenance` (the lead folio only). For an edition whose lead folio is `high` but whose later folios are lower-tier, the edition-level colophon renders **no** caveat — an edition-scope disclosure that reads "clean" over pages that are not. For an evidentiary colophon this is a small honesty gap.

I rate this low rather than higher for two reasons: (1) it is symmetric with the existing French edition-level `machine assist` disclosure, which is likewise a single edition-scope object, so this is not a regression in the colophon's established granularity; and (2) per-page OCR condition still surfaces in the page apparatus via `resolveOcrCondition`/`deriveOcrCondition`, so a low-quality page is not entirely undisclosed. Still worth a note: if the caveat is meant to certify the *edition's* OCR fidelity, sampling one folio is not sufficient — consider computing the worst tier across folios (`min` over the sequence) so the caveat reflects the edition rather than its first page.

### AUDIT-20260719-02 — English input JSON now publishes as a hard failure

Finding-ID: AUDIT-20260719-02
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/render/typst-input.ts:121-135; missing downstream surface: src/pdf/publish/issue.ts:29-75

`toTypstInput` now writes `recto.machineAssist` from `edition.colophon.translation`, which is intentionally `null` for English-source editions. That is correct for generation, but the publish path still treats every built issue input as translation-carrying: `IssueBuildInfo.machineAssist` is non-nullable, `parseMachineAssist()` requires an object, and `readIssueBuildInfo()` always parses `pages[0].recto.machineAssist`. An English-source `<issueId>.input.json` emitted by this feature will therefore fail publish/reconcile with “pages[0].recto.machineAssist must be an object”.

The blast radius is high because a downstream operator can successfully build the English PDF input, then hit a deterministic failure at publication time for the same artifact. The missing fix is to update the publish metadata reader/recording path to branch on the new colophon disclosure shape, likely reading `colophon.translation` vs `colophon.ocrTranscription` instead of assuming `recto.machineAssist` is always present. `src/pdf/publish/record.ts:200-220` also still encodes the old invariant that both `english-only` and `parallel` variants carry machine translation, so the publication metadata model needs the same English-source exception.
