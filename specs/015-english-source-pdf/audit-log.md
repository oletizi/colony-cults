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

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-07 — Publication variant and provenance disclosure can contradict each other

Finding-ID: AUDIT-20260719-07
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/bibliography/load-publications.ts:132-169

`validatePublication` validates `variant` independently from the provenance disclosure, then only enforces “exactly one of `machineAssist` or `ocrTranscription`.” That allows semantically contradictory records such as `variant: english-only` with `machineAssist`, or `variant: parallel` with `ocrTranscription`, because lines 154-169 attach whichever disclosure is present without checking it against `variant`.

This matters because the code comments define the disclosures as mutually exclusive provenance stories by language path: `machineAssist` for French machine-assisted translation, `ocrTranscription` for English-source OCR transcription. A downstream consumer loading hand-authored SSOT YAML would accept a publication whose routing/provenance disagree, and could publish or display the wrong provenance story. The blast radius is high because this is a correctness defect at a load boundary; unattended consumers would trust the loaded `Publication` as valid.

A reasonable fix is to enforce the cross-field invariant after parsing: `parallel` requires `machineAssist` and forbids `ocrTranscription`; `english-only` requires `ocrTranscription` and forbids `machineAssist`, assuming those are the intended variant semantics. If `parallel` can also represent an English-source edition, the variant vocabulary or comments need to state that explicitly so the invariant is not misleading.

### AUDIT-20260719-08 — English publish can be falsely rejected when the run's `opts.machineAssist` seed is set alongside per-issue `ocrTranscription`

Finding-ID: AUDIT-20260719-08
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/publish/modes.ts:231, 353-361, 148-149 (+ disclosure.ts:mergeDisclosure)

Both `runConfirm` and `runReconcile` seed the running disclosure unconditionally from the run option: `let disclosure: Disclosure = { machineAssist: opts.machineAssist };` (modes.ts:231, and the reconcile twin). For an English-source publish, every successful issue's `reconcileIssue`/`publishIssue` outcome carries `ocrTranscription` (and `machineAssist: undefined`). `mergeDisclosure` then folds that onto the seed, producing `{ machineAssist: <opts value>, ocrTranscription: Y }` — **both fields populated**. `recordAndCommit` spreads both into `buildInput` (modes.ts:148-149), and `buildPublication`'s exactly-one check rejects the whole run.

The per-issue `readIssueBuildInfo` XOR check guarantees each *issue* is exactly one kind, but it cannot protect against the *run-level* seed: `opts.machineAssist` is not an issue, yet it injects a `machineAssist` value that combines with English issues' `ocrTranscription`. The safety of this seed therefore depends entirely on `opts.machineAssist` being `undefined` for every English-source run — a guarantee that lives in `publish.ts` (not in this chunk) and is not asserted anywhere the diff shows. If the option resolution defaults or otherwise sets `machineAssist` for an English run, the feature's core goal (publishing English OCR editions) fails 100% of the time with a confusing "both disclosures" error. Blast-radius: an unattended operator running an English publish gets a hard failure with no path forward until they discover the invisible option coupling. A fix should make the seed kind-aware (do not seed `machineAssist` when the resolved edition is English) or drop the seed entirely and let the per-issue reads be the sole source, since `readIssueBuildInfo` already enforces exactly-one. Please verify `opts.machineAssist` resolution in `publish.ts` before closing.

---

### AUDIT-20260719-09 — English OCR disclosure can use a blank lead folio’s status for the whole edition

Finding-ID: AUDIT-20260719-09
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/load/archive-edition.ts:291-307

`buildOcrTranscription` composes `engineStatus` from the lead folio’s `ocr_status` only, while the surrounding fix correctly moved the caveat to worst-across-all-folios. That leaves a quiet false disclosure path for English editions whose first folio is an intentionally blank cover/plate: the colophon can render `tesseract 5 (none)` or another lead-only status even though later folios provide the actual English OCR reading recto.

This matters because T015 explicitly adds blank/plate handling, so a blank lead folio is now an in-scope state rather than an exotic corruption. A downstream reader or publishing path acting on the emitted colophon as written gets an edition-level OCR status that is not edition-level. The reasonable fix is to derive the displayed OCR status from the full folio set too, likely using the same all-folios provenance pass as `deriveWorstOcrCaveat`: ignore intentionally blank rectos for the “representative OCR status” when nonblank OCR folios exist, or otherwise emit an aggregate status that cannot imply the lead folio represents the edition.

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-10 — Disclosure conflict can upload an unrecorded artifact before aborting

Finding-ID: AUDIT-20260719-10
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/publish/modes.ts:81-90, src/pdf/publish/modes.ts:256-259

`publishIssue` reads the build metadata, then immediately calls `uploadArtifact` at lines 84-90 and returns the disclosure afterward. The new cross-issue invariant is enforced only back in `runConfirm` at lines 256-259, after the current issue has already been uploaded. If issue 2 carries a different `ocrTranscription` or `machineAssist` from issue 1, `mergeDisclosure` throws and aborts the run before `recordAndCommit`, but issue 2’s PDF may already be in the object store with no publication record or manifest entry.

This matters because the code explicitly protects against orphaned artifacts for malformed `input.json` by reading metadata before upload, but the new disclosure-conflict failure opens the same side-effect gap through a different channel. Blast radius is high: an operator gets a failed publish with “nothing recorded,” while durable object-store state has already changed. A reasonable fix is to validate and merge each issue’s disclosure before calling `uploadArtifact`, or split `publishIssue` so all per-issue metadata/disclosure validation for the batch happens before any confirm-mode PUTs.

### AUDIT-20260719-11 — French companion test cannot distinguish "seed preserved" from "seed dropped" — it proves nothing about the AUDIT-08 fix

Finding-ID: AUDIT-20260719-11
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/unit/publish/english-source.test.ts:~470-580 (final `describe`, "French edition: opts.machineAssist seed still works")

The final block's stated purpose (docstring above it) is to prove "the fix does not merely drop `opts.machineAssist` unconditionally, only when it would contradict an English run." That claim is **not testable by this fixture**. The French input.json is written with `pages: [{ recto: { machineAssist: FRENCH_MACHINE_ASSIST } }]` (the per-page loop near line ~525), *and* the run option is `machineAssist: FRENCH_MACHINE_ASSIST` — the **same value**. `readIssueBuildInfo` reads `machineAssist` per-page, so the recorded disclosure gets `FRENCH_MACHINE_ASSIST` regardless of whether the option-seed survives or is dropped. A regression that dropped `opts.machineAssist` unconditionally would leave this test green, because the per-page read alone supplies the recorded value. The assertion `expect(publication.machineAssist).toEqual(FRENCH_MACHINE_ASSIST)` therefore certifies a guarantee the test does not exercise.

Blast radius: this is the *only* test asserting the "don't drop the seed unconditionally" half of the AUDIT-08 invariant. An unattended agent reading the suite will treat that half as covered and refactor `runConfirm`'s seed logic freely; a real regression ships green. To actually isolate the seed channel, the per-page recto must carry **no** `machineAssist` (so the recorded value can only come from the option seed), or the option value must be a distinct object from any per-page value. As written, the two sources are indistinguishable.

### AUDIT-20260719-12 — English colophon tests use default machine-assist-bearing pages, so the "exactly-one disclosure" XOR is never asserted at the colophon boundary

Finding-ID: AUDIT-20260719-12
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/unit/pdf/colophon.test.ts:206-234 (English C6/C7 tests + `makeColophonInput` default pages at :70-73)

The pre-existing test "throws when no page carries a machine-assist label" (:166) overrides *both* default pages to `machineAssist: null` to force the throw — which means the **default** `makePage()` returns a *non-null* machine-assist label. The English C6 test (:206) deliberately sets `machineAssist: null` on its pages and correctly asserts `colophon.translation` is null. But the very next English tests — the low-fidelity caveat test (C7, :221) and the empty-`engineStatus` test (:245) — call `makeColophonInput({ readingLanguage: 'english', ocrTranscription: ... })` with the **default** pages, i.e. pages that *do* carry machine-assist labels. So these fixtures describe an English source whose pages simultaneously carry a translation credit *and* an OCR-transcription disclosure — the exact both-disclosures state the AUDIT-03/04/05/06/07 "exactly-one provenance-disclosure / variant XOR" series exists to forbid.

C7 asserts *only* `colophon.ocrTranscription?.caveat`. It asserts neither `translation === null` nor a throw. Therefore the test passes whether the English branch of `assembleColophon` (a) silently emits **both** disclosures (invariant hole — the colophon misrepresents an OCR'd English page as also machine-translated), or (b) silently **drops** the machine-assist labels (a swallowed contradiction). Either way the colophon boundary's half of the XOR invariant is unverified by the suite that claims to cover the English disclosure path.

Blast radius: an unattended agent reading this suite as the contract for the English colophon concludes "machine-assist labels + OCR-transcription coexist fine and just produce a caveat," and a future regression that re-admits both disclosures ships green. The fix is cheap and belongs in this diff: give C7/the empty-`engineStatus` test explicit `machineAssist: null` pages (like C6), and add one test asserting that an English input whose pages *do* carry machine-assist labels either throws or forces `translation === null` — pinning which side of the XOR the code takes. (PLAUSIBLE — rests on the inferred non-null `makePage` default and on `translation` tracking page `machineAssist`, both evidenced by :166 and C6 but not directly visible in this chunk.)

### AUDIT-20260719-13 — Blank-recto folios are filtered out of `representativeStatus` but still poison `worstCaveat` — the AUDIT-09 fix guarded only one of the two channels

Finding-ID: AUDIT-20260719-13 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/pdf/load/archive-edition.ts:305-322 (`deriveOcrDisclosureAggregate`)

`deriveOcrDisclosureAggregate` computes two edition-level pieces from the same read of every folio sidecar, but treats `blank_recto` folios **asymmetrically**. The `representative` selection correctly excludes them (`provenances.find((p) => p.blank_recto !== true)`), because — per the AUDIT-20260719-09 rationale quoted right above — an intentionally-blank cover/plate's own `ocr_status` is unrepresentative of the edition. But the `worst` loop iterates over **all** provenances with no `blank_recto` guard:

```js
for (const provenance of provenances) {
  const candidate = ocrSeverityOf(provenance);   // no blank_recto filter
  if (candidate.severity > worst.severity) worst = candidate;
}
```

`ocrSeverityOf` reads `ocr_status === 'failed'` and `ocr_quality.tier`. A folio marked `blank_recto: true` (T015/FR-014) is an *intentionally blank* cover/plate that carries no English OCR — yet if its sidecar records `ocr_status: failed` or `ocr_quality.tier: low/medium` (entirely plausible when the pipeline runs OCR over a blank/plate page and errors or scores it garbage), that plate now becomes the `worstCaveat` and is rendered in oxblood in the colophon as though the edition's real English OCR were degraded. This is the *exact same* "blank plate's status must never leak into the edition-level disclosure" defect AUDIT-09 identified for `engineStatus`, left unfixed in the sibling channel. Blast radius: the pinned evidentiary block asserts a false OCR-quality caveat about content that isn't OCR content at all — a direct evidence-honesty violation (Constitution I/III), built unattended into every affected edition. Fix: apply the same `blank_recto !== true` filter to the severity/`worst` aggregation (e.g. `for (const provenance of provenances) { if (provenance.blank_recto === true) continue; ... }`), and add a fixture where a blank_recto plate carries a `failed`/`low` sidecar alongside clean content folios and asserts `worstCaveat === null`.

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-14 — Mixed-KIND batch is not caught by phase-1 validation — orphaned-artifact leak AUDIT-10 targeted stays reachable

Finding-ID: AUDIT-20260719-14
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/publish/confirm-batch.ts:44-80 (validateIssueDisclosures + its docstring at lines 30-42); interacts with src/pdf/publish/disclosure.ts:63-82 (mergeField)

`validateIssueDisclosures`' docstring (confirm-batch.ts:30-42) promises that phase 1 folds "every disclosure via `mergeDisclosure`" and that "a cross-issue disclosure CONFLICT instead THROWS, propagating out to abort the WHOLE run with NOTHING uploaded yet." But `mergeDisclosure` only throws on a **same-kind** conflict (two different `machineAssist` values, or two different `ocrTranscription` values — mergeField, disclosure.ts:63-82). A **mixed-kind** batch — issue A English (`ocrTranscription` only), issue B French (`machineAssist` only) — does *not* throw: mergeField for `machineAssist` sees `current=undefined,next=set` → keeps it; mergeField for `ocrTranscription` sees `current=set,next=undefined` → keeps it. The merged `Disclosure` ends with **both** fields populated and phase 1 returns cleanly. disclosure.ts:47-52 even concedes this: the two-kinds mismatch "is left to surface via `buildPublication`'s exactly-one check on the merged result."

The problem is *ordering*. The entire justification for adding phase 1 (validate) ahead of phase 2 (`uploadValidatedIssues`) is that a disclosure abort must happen with nothing uploaded. But the mixed-kind violation is deferred to `buildPublication`, which — on the two-phase architecture this fix introduces — runs *after* `uploadValidatedIssues` has already done durable B2 PUTs. If `buildPublication` is the first place the exactly-one check fires for a mixed batch, then a mixed English+French run uploads every issue's bytes, *then* aborts at `buildPublication` → orphaned artifacts with no publication record and no manifest entry: the exact failure mode AUDIT-20260719-10 was written to close, still reachable through the un-audited mixed-kind channel. (I can't see `modes.ts` in this chunk to confirm the call order, so I price this high rather than blocking — but the whole reason phase 1 exists is that `buildPublication` is *not* pre-upload; if it were, this fix would be unnecessary.)

Fix: have `validateIssueDisclosures` assert exactly-one on the *final merged* disclosure before returning (throw if both `machineAssist` and `ocrTranscription` are populated), so a mixed batch aborts in phase 1 alongside same-kind conflicts. Add a fixture for a mixed English+French batch — the channel-enumeration driver: this fix opened a new fold path but is tested only on the same-kind conflict it names.

---

### AUDIT-20260719-15 — Mixed French/English disclosure batches still upload before failing

Finding-ID: AUDIT-20260719-15
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/publish/disclosure.ts:42-47; src/pdf/publish/confirm-batch.ts:81-88; src/pdf/publish/modes.ts:191-229

`mergeDisclosure` intentionally does not reject mixed disclosure kinds: one issue can contribute `machineAssist` while another contributes `ocrTranscription`, leaving both fields populated and deferring the failure to `buildPublication` (`disclosure.ts:42-47`). In confirm mode, phase 1 only calls `mergeDisclosure` (`confirm-batch.ts:81-88`), then phase 2 uploads every validated issue (`modes.ts:191-199`) before `recordAndCommit` eventually calls the publication boundary (`modes.ts:223-229`). That means a mixed French/English batch can still produce durable uploads and then fail publication recording, recreating the orphan-upload failure shape this split was meant to eliminate.

The blast radius is high because an operator publishing a malformed mixed batch would hit a real durable side effect with no publication record or manifest entry. A reasonable fix is to make phase-1 validation enforce exactly one disclosure kind for the merged batch before any upload, either by making `mergeDisclosure` reject “both fields now populated” or by adding an explicit post-merge assertion in `validateIssueDisclosures` before it returns.

### AUDIT-20260719-16 — English sources traverse the French-only `checkTranslationCoverage` invariant before their reading language is known

Finding-ID: AUDIT-20260719-16
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/load/archive-source.ts:194 (`checkTranslationCoverage(pageDir, sourceId, folios.length)` inside `enumerateFolios`), interacting with `deriveReadingLanguage` at :299–:335

`enumerateFolios` still calls `checkTranslationCoverage(pageDir, sourceId, folios.length)` unconditionally, and it runs *before* `deriveReadingLanguage` is ever invoked (the monograph path calls `enumerateFolios` then `deriveReadingLanguage`; the periodical path enumerates every issue before deriving). By construction the coverage check therefore **cannot** be language-aware — it fires on English sources exactly as it does on French ones. The whole premise of spec 015 is that an English source has *no* `translation/` directory and *no* `pNNN.en.txt` artifacts (per the `loadEnglishPage` header). If `checkTranslationCoverage` enforces "every folio must have a translation" (its name and the sibling `TRANSLATION_EN_PATTERN = /^p(\d+)\.en\.txt$/` strongly imply a coverage assertion), then every English source throws at resolution time and never loads — the feature's headline goal silently fails.

The blast radius is a downstream consumer building an English edition getting a hard resolution error (or, if the check is lenient, an unaudited coupling that will misfire the moment a stray `.en.txt` lands in an English source dir). This chunk introduced English routing but left the shared enumeration invariant untouched and unordered relative to language derivation; the coverage check is in another chunk (`9b6751e…`/`e7ac1f33…`) and must be verified to no-op on the English path. A correct fix either derives reading language *before* the coverage gate and skips/parameterizes it for English, or makes `checkTranslationCoverage` provably lenient when zero translation artifacts exist and asserts that with an English fixture. Anchor the guarantee with a test, because the ordering makes the two concerns invisibly coupled.

### AUDIT-20260719-17 — Colophon silently drops contradictory disclosure inputs

Finding-ID: AUDIT-20260719-17
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/load/colophon.ts:124-147, src/pdf/load/colophon.ts:173-175

`assembleColophon` selects the English or French output branch solely from `readingLanguage`, but the branch implementations silently discard disclosure inputs that contradict that branch. On the English path, `assembleEnglishColophon` never inspects `pages`, so non-null per-page `machineAssist` labels are dropped while emitting `translation: null` and `ocrTranscription` as if the input were clean. On the French path, `ocrTranscription` is ignored by routing to `assembleFrenchColophon`.

That violates the fail-loud provenance discipline this feature is trying to harden: a caller can hand the boundary a both-disclosures state, and the PDF metadata emitted downstream will hide one side instead of exposing the inconsistency. The blast radius is high because provenance disclosure is user-facing and curatorial; an upstream reading-language or fixture bug could ship a plausible but incomplete disclosure with no failure signal.

A reasonable fix is to make `assembleColophon` validate the branch invariant before returning: for `readingLanguage === 'english'`, reject any page with `machineAssist !== null`; for `readingLanguage === 'french'`, reject non-null `ocrTranscription`. That turns contradictory provenance into an actionable build failure instead of a silent normalization.

### AUDIT-20260719-18 — buildPublication tests encode "ocrTranscription satisfies any variant" — no variant↔disclosure-type guard

Finding-ID: AUDIT-20260719-18
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/publish/record.test.ts:186-236

The `buildPublication` describe defines a single `base` and reuses it across three assertions. The first (record.test.ts:186-190) is titled "throws if a translation-carrying (**French**) edition lacks BOTH machineAssist and ocrTranscription" and calls `buildPublication({ ...base, machineAssist: undefined }, ...)` expecting a throw — establishing `base` as a translation-carrying variant. The new AUDIT-02 test (record.test.ts:205-214) then reuses that **same `base`**, swaps in `ocrTranscription: OCR_TRANSCRIPTION`, and asserts it does **not** throw. The only delta between the throwing French case and the passing case is the presence of an *OCR-transcription* disclosure. That means the contract these tests pin is "an `ocrTranscription` disclosure satisfies the Constitution-IV disclosure requirement for whatever variant `base` carries" — with no assertion anywhere that the disclosure *type* matches the *variant* (english-only ↔ ocrTranscription; translation-carrying ↔ machineAssist).

If `buildPublication` is genuinely variant-agnostic here (which is exactly what this test pair blesses), then a translation-carrying French edition whose `input.json` presents an `ocrTranscription` instead of a `machineAssist` label would pass `buildPublication` and publish with **no machine-translation disclosure at all** — a provenance-laundering hole that the whole AUDIT-03/04/05/06 "exactly-one provenance-disclosure" line of work exists to prevent. The exactly-one-of check catches "zero disclosures" and "both disclosures," but nothing shown catches "the *wrong* disclosure for this variant." Blast radius: an unattended build of a French edition with a malformed/misrouted input silently ships without the MT label. Fix: add a test that constructs an explicitly translation-carrying variant with *only* `ocrTranscription` and asserts it throws, and (if the impl doesn't enforce it) add the variant↔disclosure-type invariant to `buildPublication`. At minimum, give the English-source test its own english-only `base` rather than inheriting the French one, so the encoded contract is unambiguous.

### AUDIT-20260719-19 — `deriveOcrDisclosureAggregate` re-reads every folio's provenance sidecar independently of the sidecars already read for the colophon/lead

Finding-ID: AUDIT-20260719-19 (claude-03 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=informational, codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/pdf/load/archive-edition.ts:254-265 (`Promise.all(unit.folios.map(readProvenance))`)

For English editions, `deriveOcrDisclosureAggregate` issues its own `Promise.all` over `readProvenance` for **every** folio, in addition to the lead-provenance read (`readLeadProvenance`) and whatever provenance the per-page `loadArchivePage` / `colophonPages` path already consumes. The docstring's "ONE shared read" is true only *within* this function; across the edition-build it is an extra full pass over all sidecars on the English path. The files are static so there is no correctness/race hazard, and the parse fails loud on malformed sidecars, so this is informational rather than a defect.

Worth surfacing only as a design note for the operator: if the per-page assembly already parses each folio's provenance (it must, to compute `ocrCondition`), the severity aggregation could be folded into that single pass rather than a second traversal, avoiding O(folios) redundant reads on every English build. I did not have `archive-page.ts`/`colophon.ts` in this chunk to confirm the parsed provenance is reachable for reuse, which is why I'm flagging it as context rather than a required change.

---

Checks that came back clean and why: the exactly-one disclosure invariant in `frontmatter.typ` (`if col.translation != none … else …`) is sound *given* the upstream guarantee that English editions set `translation: null` + `ocrTranscription`, and French set the inverse (enforced by AUDIT-03/04/05/06 and colophon assembly's French-no-label throw); the `blank_recto === true` filter is now applied identically to both aggregations (the AUDIT-13 fix), closing the sibling-channel leak; the severity ranking (`failed` 3 > `low` 2 > `medium` 1 > clean 0) with strictly-`>` comparison is correct and tie-stable; and the French render path is byte-for-byte unchanged. The one hardcoded value, `OCR_ENGINE = 'tesseract 5'`, is adequately justified (the provenance schema has no per-page engine field) and single-sourced, so I did not flag it.

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-20 — Removed zero-folio guard replaced by an unverified upstream claim; English path silently yields `undefined` lead provenance

Finding-ID: AUDIT-20260719-20
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/load/archive-edition.ts:211-256 (new `resolveLeadAndAggregateProvenances` / `readFolioSidecar`)

The old `readLeadProvenance` carried an explicit, descriptive fail-loud guard:

```
const lead = unit.folios[0];
if (lead === undefined) {
  throw new Error(`${context}: the resolved item has no folios.`);
}
```

The refactor **deletes that guard** and replaces it with a doc-comment assertion: "`unit.folios` is non-empty by the time this is called (`build()` fails loud on a zero-folio unit first)." Nothing in this diff shows `build()` performing that check — `selectUnit` returns `resolution.folios`/`issue.folios` verbatim with no emptiness assertion, and the only prior consumers (`unit.folios.map(...)` for `loadArchivePage`/`toEditionPage`) tolerate an empty array silently. If the claimed earlier guard does not actually exist, a zero-folio unit now behaves two different bad ways: on the **English path**, `await Promise.all([])` → `allProvenances[0]` is `undefined`, returned as `leadProvenance` (typed `ProvenanceFields`, actually `undefined`) — a *silent* corrupt value that flows into `resolveTitleAndRights` and `deriveOcrDisclosureAggregate([])`; on the **French path**, `readFolioSidecar(unit.folios[0])` dereferences `undefined.pageDir` → an unlabeled `TypeError` that has *lost* the old descriptive `"has no folios"` message.

The silent-`undefined` English case is exactly the bug-factory CLAUDE.md warns against (no throw, corrupted downstream data). The correct fix is to keep the explicit zero-folio throw *inside* this function (or prove and cite the `build()`-level guard), rather than couple correctness to an invariant that is neither visible nor enforced in this file. The blast radius: any malformed/empty resolved unit produces a corrupt title page/colophon on the English path with no error — an unattended build would emit a wrong PDF, not fail.

### AUDIT-20260719-21 — Serializer now emits `ocrTranscription`, but the SSOT loader's closed key allow-list must accept it or every write→read round-trip fails loud

Finding-ID: AUDIT-20260719-21
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/bibliography/migrate-serialize.ts:182-188 + src/bibliography/load-publications.ts (cross-chunk 4f30799e8794aed7)

`orderedPublication` now writes an `ocrTranscription` key when present. The SSOT load path validates each publication object with `assertKnownKeys(obj, PUBLICATION_KEYS, ...)` — a *closed* allow-list that fails loud on any unrecognized key. The `PUBLICATION_KEYS` set deleted from `load.ts` in this very diff (lines shown removed) did **not** contain `ocrTranscription`:

```
const PUBLICATION_KEYS = new Set([
  'variant','publishedAt','snapshot','snapshotShort','cdnBase',
  'keyScheme','rightsBasis','machineAssist','manifest',
]);
```

The validator was moved to `@/bibliography/load-publications` (not visible in this chunk). If that relocated allow-list was copied verbatim without adding `'ocrTranscription'`, then any English-source publication this serializer writes can never be re-loaded: the next `loadSourceFile` will fail on the unknown key. That is total round-trip breakage for the feature's own output — blocking if true. Because I cannot see `load-publications.ts` from this chunk, I flag it as a hard dependency the operator must verify: the new closed key set in `load-publications` **must** include `ocrTranscription`, and there should be a round-trip fixture (serialize an English publication, reload it) proving it. Absence of such a fixture is itself a coverage gap given the serializer just gained a new emitted key.

### AUDIT-20260719-22 — Mixed French/English confirm batches still upload before failing

Finding-ID: AUDIT-20260719-22
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/publish/disclosure.ts:42-47, src/pdf/publish/confirm-batch.ts:81-88

`mergeDisclosure` explicitly allows a cross-kind mismatch to accumulate both fields and defers rejection to `buildPublication` (`disclosure.ts:42-47`). In confirm mode, `validateIssueDisclosures` uses that merge as phase 1 (`confirm-batch.ts:81-88`), so a batch containing one French-source issue (`machineAssist`) and one English-source issue (`ocrTranscription`) passes validation with `{ machineAssist, ocrTranscription }` populated. Phase 2 then uploads the validated PDFs before `recordAndCommit`/`buildPublication` rejects the exactly-one violation.

The blast radius is high because this reopens the orphan-upload class the new two-phase pipeline is meant to close: durable object-store writes can happen with no publication record or manifest if the failure is a cross-kind disclosure conflict. A reasonable fix is to enforce the exactly-one disclosure invariant inside phase 1, either by making `mergeDisclosure` throw when the merged result would contain both fields or by validating the final disclosure before `uploadValidatedIssues` is called.

### AUDIT-20260719-23 — Loader-only variant/disclosure guard leaves the write path able to persist unloadable publications

Finding-ID: AUDIT-20260719-23
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/bibliography/load-publications.ts:124-147, src/bibliography/load-publications.ts:202-208; missing matching guard in src/pdf/publish/record.ts buildPublication

The new loader correctly states and enforces that `variant: "parallel"` must carry `machineAssist` and must not carry `ocrTranscription`: `assertVariantMatchesDisclosure` rejects `parallel` + `ocrTranscription` at load time, and `validatePublication` calls it after the XOR check. That makes a hand-authored bad SSOT fail loud, which is good.

The problem is that this invariant is only added on the read boundary. The publish record path still constructs `Publication` from `variant` plus whichever disclosure was read from built issue inputs, and the surrounding publish options keep `variant` as an operator/CLI choice rather than deriving it from the disclosure shape. A mistaken or unattended publish of an English OCR build with `variant: "parallel"` can therefore write a `publications[]` entry that this loader will reject on the next `loadSourceFile` call. The blast radius is high because the project can persist its own invalid source-of-truth record, breaking subsequent validation/load workflows rather than failing before mutation.

A reasonable fix is to move this exact `parallel` + `ocrTranscription` rejection into the write boundary too, ideally in `buildPublication` where the exactly-one disclosure invariant already lives, and add a writer-side test mirroring the new loader fixture.

### AUDIT-20260719-24 — `ArchivePageContent.untranslatable` doc says "Always false on the ENGLISH path" but `loadEnglishPage` sets it `true`

Finding-ID: AUDIT-20260719-24
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/pdf/load/archive-page.ts — `ArchivePageContent.untranslatable` field doc vs `loadEnglishPage` blank_recto return branch

The interface contract for the `untranslatable` field, added in this diff, states unconditionally: *"True when the page's translation artifact is labeled `untranslatable` (FRENCH path only). **Always `false` on the ENGLISH path** -- an English page has no translation dimension."* But `loadEnglishPage`'s blank_recto branch returns `untranslatable: true` (the branch that reuses spec 014's blank-recto rendering — the `loadEnglishPage` doc itself openly says it produces "`untranslatable = true`, `english = ''`"). The interface doc directly contradicts the observable behavior it documents, in the same diff.

Blast-radius: `ArchivePageContent` is a shared contract surface consumed by the Typst-input renderer and other chunks I cannot see. An unattended agent building or modifying English-page rendering will reach the interface doc *first* (it is the authoritative contract) and the more-natural reading — "for English pages `untranslatable` is always false" — is the wrong one. Such a consumer could `assert(!untranslatable)` for the English path, or skip blank-recto handling entirely for English, breaking the T015 blank/plate case (FR-014) that this very feature adds. The shipped renderer happens to work because it reuses the untranslatable path, so nothing in the artifact corrects the wrong reading. Fix: change the field doc to state the real invariant — "`true` for a FRENCH `untranslatable` page **or** an ENGLISH `blank_recto` plate (FR-014); both drive the shared blank-recto rendering."

### AUDIT-20260719-25 — Empty `provenances` array yields the misleading error "every folio is blank_recto-marked"

Finding-ID: AUDIT-20260719-25 (claude-04 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=low, codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/pdf/load/archive-ocr-disclosure.ts:143-148 (`deriveOcrDisclosureAggregate`)

If `provenances` is empty, the loop never runs, `representative` is `undefined`, and the thrown message reads *"every folio is blank_recto-marked -- no folio has a usable OCR status."* That diagnosis is wrong for the empty case: there are zero folios, none of them blank_recto. An operator reading the error would hunt for spurious `blank_recto` markers that don't exist. Whether an empty array is reachable depends on the caller (`resolveLeadAndAggregateProvenances`, another chunk), but the function itself makes no distinction. Blast-radius is low — it only misdirects debugging in a degenerate zero-folio edition — but a one-line guard (`if (provenances.length === 0) throw \`${context}: no folios\``) before the blank-recto message would keep the fail-loud honest.

### AUDIT-20260719-26 — English colophon test blesses silently dropping contradictory provenance

Finding-ID: AUDIT-20260719-26
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/pdf/colophon.test.ts:283-301

The new test deliberately constructs an English colophon input whose pages still carry non-null `machineAssist` labels, then asserts that `assembleColophon` returns `translation: null` and `ocrTranscription` instead of rejecting the contradiction. The comments at lines 286-299 frame this as pinning the XOR, but it actually pins silent normalization of an invalid both-disclosures input state.

That matters because the feature’s invariant is provenance-disclosure exclusivity: English OCR editions should carry OCR-transcription disclosure, while French translated editions should carry machine-assist disclosure. If a bad upstream boundary leaks machine-assist labels into an English edition, this test now says the colophon boundary should discard that evidence without error. Blast radius is high: an unattended consumer can rely on this test as the contract and preserve a path where contradictory provenance is hidden rather than failed loud. A reasonable fix is to change this test to expect a throw when `readingLanguage: 'english'` and any page has `machineAssist !== null`, and add the symmetric French-path rejection for non-null `ocrTranscription`.
