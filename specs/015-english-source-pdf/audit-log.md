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

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-03 — Provenance-disclosure invariant ("at least one", "mutually exclusive") is asserted in three comment sites but enforced at neither load boundary

Finding-ID: AUDIT-20260719-03
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/bibliography/load.ts:237-241 (the new `ocrTranscription` branch) + src/model/publication.ts:104-117 + src/bibliography/migrate-serialize.ts:156-177

The new field is introduced with a strong, repeated invariant: `publication.ts` says "`buildPublication` requires at least one of the two to be present (Constitution IV — no publication with zero provenance disclosure)"; `load.ts:198-203` says the two are "each optional and mutually exclusive in practice"; `load-publication-fields.ts:3-5` says `ocrTranscription` is recorded "INSTEAD OF" `machineAssist` ("never both"). But `validatePublication` enforces **neither half** of that invariant. The two branches are independent `if (obj.X !== undefined)` shape-checks (`load.ts:231-241`): a record with **both** disclosures passes (violating mutual exclusivity), and a record with **neither** passes (violating the Constitution IV "zero provenance" rule the comment itself cites). The recurring hedge "in practice" is the tell that nothing enforces it.

This matters because `validatePublication`'s own docstring promises "Any malformed shape fails loud (no silent drop)" — and a zero-provenance publication *is* malformed per the cited Constitution IV, yet it loads silently. The comment redirects the reader to `buildPublication` as the enforcement point, but `load.ts` is a **distinct deserialization path** for hand-authored SSOT files (its whole purpose is catching malformed authored input); records entering through it do not necessarily transit `buildPublication`. Blast radius: an unattended agent authoring a new English-source publication record forgets `ocrTranscription`, `load.ts` accepts it, and a publication ships with zero provenance disclosure — the exact failure the comments claim is impossible, made more dangerous by the false assurance the comments create. The fix: enforce the XOR at load — after both branches, require exactly one of `machineAssist`/`ocrTranscription` to be set (or state explicitly, invariant-first, why the load path is deliberately *not* an enforcement boundary and where the single enforcement point actually is). Note: `buildPublication` lives in another chunk (`bb2d995`), so I cannot confirm its check exists; if it does, the load path is still an un-backstopped second door to the same invariant.

### AUDIT-20260719-04 — `machineAssist` and `ocrTranscription` can be loaded together

Finding-ID: AUDIT-20260719-04
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    `src/bibliography/load.ts:233-241`, `src/bibliography/migrate-serialize.ts:172-176`, `src/model/publication.ts:104-116`

The diff repeatedly states that `ocrTranscription` is recorded “INSTEAD OF” `machineAssist` and is “mutually exclusive” with it, but the loader accepts both on the same publication. `validatePublication` independently assigns `publication.machineAssist` and `publication.ocrTranscription` when both keys are present, and `orderedPublication` serializes both fields back out. The type also models both as independent optional properties, so TypeScript does not prevent the invalid state.

This matters because the new English-source disclosure is specifically meant to avoid presenting OCR transcription as machine translation provenance. A malformed record with both fields would pass validation, persist deterministically, and give downstream PDF/publish code two conflicting provenance disclosures to interpret. The reasonable fix is to fail loud when both fields are present, ideally at the publication loader boundary, and keep serializer/model comments aligned with that invariant.

### AUDIT-20260719-05 — Both-disclosures state is now accepted but the invariant says exactly one

Finding-ID: AUDIT-20260719-05
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/unit/publish/issue.test.ts:52-108; tests/unit/publish/record.test.ts:204-224

The new tests prove the two valid single-disclosure cases: English OCR via `colophon.ocrTranscription` and French translation via `pages[0].recto.machineAssist`. They never exercise the composition channel opened by the fix: an input carrying both disclosures. The production comments state the invariant as “EXACTLY ONE,” but `readIssueBuildInfo` accepts both, and `buildPublication` records both when both are provided.

This matters because the downstream `Publication` record is the provenance contract. A consumer seeing both fields cannot tell whether the edition is a translated French source, an English OCR transcription, or a mixed invalid build. Blast radius is high: this is a quiet provenance corruption path that an unattended publisher can create without an error. A reasonable fix is to add red tests for both-present `input.json` and both-present `buildPublication` input, then enforce mutual exclusivity at the parser/record boundary.

### AUDIT-20260719-06 — Multi-issue publish only tests identical OCR disclosures, leaving first-seen publication metadata unchecked

Finding-ID: AUDIT-20260719-06
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/publish/english-source.test.ts:116-119; tests/unit/publish/english-source.test.ts:158-169

The end-to-end English-source publish fixture writes the same `OCR_TRANSCRIPTION` object for every issue, then only checks that the recorded `Publication` has that one object. That misses the state channel where different issues in the same publish set have different OCR conditions or caveats. The local publish path merges disclosure with first-seen-wins, so a later issue with a worse caveat can still be published while the source-level publication metadata records the first issue’s disclosure.

This has high blast radius because the project recently fixed colophon caveats to reflect worst OCR tier across folios; publishing then collapsing multi-issue metadata to the first successful issue can understate OCR quality caveats in the durable bibliography record. A reasonable fix is to add a publish/reconcile test with two English-source issues whose `colophon.ocrTranscription` values differ, and make the record path either reject inconsistent per-issue disclosures or compute an explicit edition-level aggregate.
