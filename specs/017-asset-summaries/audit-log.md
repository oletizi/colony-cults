---
slug: 017-asset-summaries
targetVersion: ""
---

# Audit log — 017-asset-summaries

## 2026-07-22 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260722-01 — Papers Past sources bypass the new concise-summary loader

Finding-ID: AUDIT-20260722-01
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/browser/load/raw-corpus.ts:99-105; src/browser/load/papers-past.ts:141-156

`loadSource` returns immediately for Papers Past sources before the new `sourceDir` / `loadSourceSummary` and `buildRawIssue` / `loadIssueSummary` paths run. The Papers Past loader then constructs its `RawIssue` and `RawSource` without `conciseSummary`, so even if `issue.summary.short.en.md` or `source.summary.short.en.md` exists beside the clipping unit, the browser model will silently render the “No summary yet” state.

This matters because spec 017 explicitly includes “the English-language Papers Past items” in v1 coverage, and the summarization research notes that Papers Past uses English OCR as a valid input layer. The blast radius is high: downstream browser users get a plausible but false absence signal for an in-scope source family, with no exception or warning. A reasonable fix is to make `loadPapersPastSource` attach `loadIssueSummary(unit.dir)` to its single issue and `loadSourceSummary(unit.dir)` to the returned source, or route the returned `RawSource` through a shared summary-enrichment helper so the special loader cannot drift from the standard path.

### AUDIT-20260722-02 — `runSummarizeSource` weld crashes on a `'skipped'` rollup if `thoroughPath` is unset

Finding-ID: AUDIT-20260722-02
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/summarize.ts:270-276 (`runSummarizeSource`, the Constitution-XV weld block)

The weld computes `const ref = path.relative(d.archiveRoot, result.thoroughPath)` unconditionally on the non-dry-run path, and the doc comment explicitly asserts this must run "even on an idempotent `'skipped'` rollup … so a prior run could have written the rollup artifact but been interrupted before the SSOT write." That reasoning only holds if `summarizeSource` populates `result.thoroughPath` on the `'skipped'` branch. Nothing in this chunk guarantees it — `summarizeSource`/`SummarizeSourceCtx` live in `src/summarize/source-rollup.ts` (out of scope here). If a short-circuited `'skipped'` return leaves `thoroughPath` undefined, `path.relative(archiveRoot, undefined)` throws `TypeError: The "to" argument must be of type string`, and it throws *after* the success line `summarize-source: X -> skipped` has already been logged.

The blast radius is precisely the US5 resumable-idempotency path the comment is defending: a re-run of an already-complete source would crash instead of re-asserting the ref. This is the invariant to verify: **`summarizeSource` must return a resolved `thoroughPath` on every non-dry-run status, including `'skipped'`.** A reasonable hardening is an explicit guard here (`if (!result.thoroughPath) throw new Error('summarize-source: rollup returned no thoroughPath for <sourceId>')`) so the failure is legible rather than a raw TypeError, plus a fixture that runs `summarize-source` twice and asserts the second (skipped) run still rewrites the ref. Marked PLAUSIBLE pending the cross-file check.

### AUDIT-20260722-03 — CLI ignores the configured summarizer model

Finding-ID: AUDIT-20260722-03
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/summarize.ts:51-55, src/cli/summarize.ts:191-195

Both default dependency builders call `resolveSummarizerName(args.options.engine)` and `resolveSummaryModel(args.options.model)` without ever loading or passing a `SummaryConfig`. The comment at lines 43-47 explicitly says no config layer is consulted, but the feature contract requires model selection to be configurable with `flag > config > default`. As shipped, an operator can only use the built-in default or a per-run flag; any repository default model/engine is silently impossible to apply.

Blast radius is high because downstream users running unattended corpus jobs will believe the configured model is in effect while the CLI records and invokes `claude-sonnet-5` unless every run passes `--model`. A reasonable fix is to add the same kind of loader used by `src/engine/config.ts`, pass the loaded config into both resolver calls, and cover the no-flag path with an integration or unit test against `buildSummarizeCliDeps` / `buildSummarizeSourceCliDeps`.

### AUDIT-20260722-04 — Idempotent reruns still require the Claude CLI preflight

Finding-ID: AUDIT-20260722-04
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/summarize.ts:112-116, src/cli/summarize.ts:243-245

`runSummarize` and `runSummarizeSource` execute `d.preflight()` before calling the lower-level summarization functions. The lower layers are where the idempotency checks happen, so an already-complete issue or rollup that would return `skipped` still requires `claude` to be installed and runnable before the skip can be observed.

Blast radius is high because US5’s resumability promise depends on unattended reruns being cheap and not invoking the LLM path for unchanged inputs. In an environment where Claude is unavailable, expired, or intentionally absent for a verification-only rerun, the command fails before it can skip completed work or repair the source `summaryRef` on a skipped rollup. A reasonable fix is to move preflight to the actual generation boundary, after dry-run and freshness checks, so it runs only when `runner.summarize` is about to be called.

### AUDIT-20260722-05 — Large OCR input passed as a `claude --print` command-line argument will exceed ARG_MAX for whole-issue finding aids

Finding-ID: AUDIT-20260722-05 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/summarize/runner-claude.ts:26-34 (args construction) + src/summarize/prompt.ts:120-153 (`buildSummaryPrompt`)

`createClaudeSummarizer.summarize` folds the *entire* source document text into the prompt string via `buildSummaryPrompt(inputText)` and passes that whole string as a positional CLI argument: `['--print', buildSummaryPrompt(inputText), ...]`. The module docblock in `prompt.ts` calls this out as a deliberate divergence from the translation engine — "Unlike `TranslationEngine.run`, which takes the instruction and the source text as two separate arguments (prompt on the CLI argument, source text on stdin), ... this function folds both the instruction and the input text into the single returned prompt string, intended to be passed whole as the `claude --print <prompt>` argument." The translation engine puts source text on **stdin** for exactly one reason: to avoid the OS argument-length ceiling.

This feature's stated purpose is a *thorough, exhaustive, no-length-cap* finding aid over a full periodical issue's text (`prompt.ts`: "Be exhaustive -- there is no length cap"). For a French source, `selectSummaryInput` concatenates BOTH the French OCR and its English translation (`combineFrenchAndEnglish`), roughly doubling the payload. A whole issue's OCR-plus-translation can easily reach several hundred KB to over 1 MB. On macOS the effective `ARG_MAX` after environment overhead is well under 1 MB; a single oversized argument yields `E2BIG` (`spawn ... E2BIG`) at exec time. The failure is *input-size-dependent*: small test fixtures pass, real archive issues — the intended workload — fail. Because the runner only handles `exitCode !== 0` with a generic stderr message, the operator gets an opaque exec failure rather than a diagnosable one.

A reasonable fix mirrors the translation engine: pass the fixed instruction/system framing as the argument and stream `inputText` on stdin (or write it to a temp file and reference it), so payload size no longer competes with `ARG_MAX`. At minimum, the divergence should be justified against a measured maximum issue size, not asserted.

### AUDIT-20260722-06 — Empty or whitespace-only text layers are treated as usable input

Finding-ID: AUDIT-20260722-06
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/summarize/select-input.ts:126-158

`selectSummaryInput` checks only whether `issue.txt` / `issue.en.txt` exists, then reads and returns the text without validating that any selected layer contains non-whitespace content. An empty `issue.txt` at lines 152-158 becomes `text: ocr.text`; an empty translation plus OCR at lines 137-148 also becomes summarizer input. That violates the fail-loud intent described at lines 111-116: an existing but empty OCR/translation file is not a usable text layer.

Blast radius is high because failed OCR or truncated acquisition can silently progress into an LLM call. The model may produce a generic or hallucinated summary from delimiters and instructions alone, creating research metadata that looks valid. The selector should reject empty/whitespace-only selected layers with a descriptive error before summary generation.

### AUDIT-20260722-07 — Idempotency skip is keyed only to the thorough sidecar — a run interrupted between the two writes leaves the concise summary permanently missing

Finding-ID: AUDIT-20260722-07 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/summarize/issue.ts (idempotency guard ~L130-133 + the two `storeAsset` calls ~L155-175); src/summarize/idempotency.ts:57-72

`summarizeIssue` writes two artifacts as two *separate* `storeAsset` operations: thorough first (issue.ts ~L156), concise second (~L168). Each `storeAsset` is atomic on its own, but there is no atomicity *across* the pair. The idempotency guard that decides skip-vs-regenerate consults `summaryIsUpToDate`, which in turn (`idempotency.ts:57`) resolves `companionYamlPath(issueThoroughSummaryPath(issueDir))` — **only the thorough sidecar**. The concise artifact is never checked for existence.

Failure scenario: a run stores the thorough artifact (bytes + sidecar with correct `input_layers`) and is then interrupted (crash, SIGINT, host OOM) before the concise `storeAsset` completes. On the next non-forced run, `selectSummaryInput` produces the same layers, `checkSummaryFreshness` finds the thorough sidecar's `input_layers` match exactly → `'up-to-date'` → `summarizeIssue` returns `status: 'skipped'` and the concise summary is **never generated**. The gap is silent and permanent until someone passes `--force`. This directly defeats the US5 "resumable idempotency" goal for the one case idempotency most needs to cover — an interrupted mid-write. A reasonable fix: have the freshness check require *both* the thorough and concise sidecars to exist and match, or gate the skip on `existsSync` of both artifact companions, so a half-written pair reads as `'stale'`/`'fresh'` and regenerates.

### AUDIT-20260722-08 — Non-atomic two-artifact write plus thorough-only idempotency key strands the concise rollup after an interrupt

Finding-ID: AUDIT-20260722-08
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/summarize/source-rollup.ts:117-135 (isUpToDate), 258-273 (the two storeAsset calls)

`summarizeSource` writes two independent artifacts sequentially — first the thorough (`storeAsset(...thoroughPath...)`), then the concise (`storeAsset(...concisePath...)`) — with no atomicity across the pair. `isUpToDate`, however, keys the entire skip decision on **only the thorough** artifact's sidecar: `const yamlPath = companionYamlPath(sourceThoroughSummaryPath(sourceDir));`. If the process is interrupted between the two writes — operator Ctrl-C, an OOM, or an `fs`/manifest error on the second `storeAsset` — the thorough artifact and its `input_layers` sidecar are persisted while the concise artifact is never written. On the next non-`--force` run, `isUpToDate` reads the thorough sidecar, finds the covered-issue layers match exactly, returns `true`, and the run **skips** — permanently leaving the source with a thorough rollup but no concise rollup. Nothing on the idempotent path ever repairs it; the operator must know to pass `--force`.

This is squarely the resumability contract US5/FR-010 exists to guarantee, and the concise rollup is the artifact the US2 browser abstract loader consumes — so the silent gap surfaces as a source that renders no summary abstract, with an idempotent rerun actively concealing the missing byte. A downstream operator re-running `summarize-source` to "make sure it's complete" gets a green skip over a broken state. A reasonable fix keys the skip on the presence-and-match of **both** artifacts (check `concisePath` and its sidecar too), or writes a single completion marker only after both `storeAsset` calls succeed, so a half-write is never mistaken for done.

## 2026-07-22 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260722-09 — Rollup coverage is not recorded in provenance sidecars

Finding-ID: AUDIT-20260722-09
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/summarize/artifacts.ts:88-111, src/summarize/artifacts.ts:152-189

The rollup contract says `covered_issues` and `missing_issues` belong in the rollup sidecar provenance, but this implementation records them in markdown frontmatter instead. Lines 88-111 explicitly add those fields to `source.summary.long.en.md`; meanwhile `buildSummaryProvenance` at lines 152-189 has no structured field for rollup coverage. This also diverges from `specs/017-asset-summaries/contracts/cli-summarize.md:34-37` and `contracts/summary-artifacts.md:57`, which both name provenance/sidecars as the coverage surface.

Blast radius is high because downstream audit or browser/indexing code that reads companion YAML as the provenance API will not see structured coverage. It will only get a prose `notes` string from the rollup path, which is not a reliable machine contract. A reasonable fix is to add canonical optional coverage fields to provenance serialization/parsing, populate them for source rollups, and assert through `readProvenance` that sidecars carry the exact covered/missing issue lists.

### AUDIT-20260722-10 — Empty / whitespace-only concise artifact is accepted at load, contradicting the feature's own fail-loud convention (AUDIT-06) and the snapshot parser

Finding-ID: AUDIT-20260722-10
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/browser/load/summary.ts:96-104 (`loadSummaryArtifact`), cross-checked against src/browser/load/snapshot-guards.ts:112-127 (`parseLoadedSummary`)

`loadSummaryArtifact` does `const concise = readFileSync(mdPath, 'utf-8').trim();` and then unconditionally returns `{ concise, label }`. There is no check that `concise` is non-empty. So a **present-but-empty** or whitespace-only `issue.summary.short.en.md` / `source.summary.short.en.md` produces `concise: ''` and is treated as a valid loaded summary. This is exactly the shape AUDIT-06 (commit 5e40beb, "reject empty/whitespace text layers — fail loud") established as a defect for text layers, regressing in a brand-new loader. The file's own sidecar handling is fail-loud on a missing/incomplete label, but the primary payload (the summary text) is not — an incoherent posture: a summary with a blank *body* but a valid label sails through, while a summary with valid body but blank label throws.

This is worse than cosmetic because of an asymmetry with the round-trip parser. `parseLoadedSummary` (snapshot-guards.ts) reads `concise: requireString(record, 'concise', where)`. `requireString` in this codebase rejects empty strings (the sibling `requireStringField` in this very diff, summary.ts:126-137, explicitly treats `.trim().length === 0` as missing-and-throws). So the two ends disagree: the loader **accepts** `concise: ''` and attaches it to the `RawSource`/`RawIssue`, the serializer writes it into the committed snapshot, and the next load's `parseLoadedSummary` **throws** on re-parse. A source/issue that loads cleanly on the summarizing machine then crashes the browser build on every subsequent snapshot load — a self-inflicted data-integrity failure with no operator signal at the point it was introduced.

Fix: in `loadSummaryArtifact`, after trimming, treat an empty `concise` the same way the rest of the feature treats empty text — either fail loud (`throw` naming `mdPath`, since a present-but-empty artifact is corruption, not absence) or, if a blank summary should mean "not yet summarized," delete/skip it as absence and return `null`. Whichever is chosen, it must match `requireString`'s contract on the parse side so the round-trip is symmetric. Add a fixture for the empty-artifact channel (the value channel opened by this new load path).

---

## 2026-07-22 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260722-11 — Idempotency keys only on covered layers, so a newly-missing issue never refreshes the canonical `missing_issues` provenance

Finding-ID: AUDIT-20260722-11 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/summarize/source-rollup.ts:186-207 (`isUpToDate`) + 133-165 (`gatherCoverage`) + docstring step 4

`isUpToDate` compares only `coveredLayers` (path + sha256 of *covered* issue thorough summaries). The `missing` set is never part of the idempotency key. Yet the summarizeSource docstring (FLOW step 4) explicitly asserts: *"A newly-covered or newly-missing issue changes this set, so a rollup re-run naturally picks up new coverage."* That is false for the newly-**missing** half: fetching a new issue directory (creating it on disk) without yet summarizing it makes `gatherCoverage` classify it as `missing`, but `coveredLayers` is unchanged, so `isUpToDate` returns true and the run **skips** — no engine call, no write.

The consequence is that the recorded `covered_issues`/`missing_issues` structured fields and the `coverageNote` (lines ~315-345) stay stale after such a skip. AUDIT-20260722-09 (referenced at line ~305) *promoted these fields to the canonical, machine-readable coverage contract* that "downstream audit/browser/indexing code reads via `readProvenance`." So the exact contract the fix hardened silently under-reports the gap: an auditor querying `missing_issues` on the rollup sidecar sees a stale, incomplete missing set and concludes coverage is more complete than it is. Blast radius: an unattended indexing/audit consumer acting on `missing_issues` as-written draws a wrong coverage conclusion, and the code comment actively tells the next maintainer this can't happen. Fix: fold the `missing` ark set (or its cardinality/identity) into the idempotency key, or decouple the coverage-metadata rewrite from the engine call so metadata refreshes even when prose regeneration is unnecessary.

### AUDIT-20260722-12 — summaryRef validation can accept paths outside the archive root

Finding-ID: AUDIT-20260722-12
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/summary-reference.test.ts:104-145

The tests validate the happy path and dangling path through `writeSummaryRef`-created sources, and only assert writer rejection for blank and absolute paths at lines 140-144. That leaves the raw-loaded YAML channel untested: `summaryRef` is just `Source.summaryRef?: string`, so an existing source file can contain `../outside.md` without going through `writeSummaryRef`. The validator implementation then does a plain `join(archiveRoot, ref)` and `existsSync`, so a traversal ref can resolve outside `archiveRoot` and pass if that file exists.

This breaks the archive-relative invariant the test comments rely on. The blast radius is high because downstream bibliography validation/browser code can treat an escaped file as a valid rollup artifact, welding metadata to a summary outside the archive tree. A reasonable fix is to centralize summaryRef path validation and apply it inside `validateSummaryRef` as well as `writeSummaryRef`, rejecting absolute paths, `..` traversal, and any normalized resolved path whose relative path escapes `archiveRoot`; add a raw-loaded YAML fixture for that case.

### AUDIT-20260722-13 — Config loader silently accepts malformed known keys

Finding-ID: AUDIT-20260722-13
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/summarize/config.test.ts:74-106

The config tests cover a valid model/engine, unknown engine, invalid JSON, non-object root, and unknown-key tolerance. They do not cover malformed values for known keys. In the implementation this matters: `readConfig` only copies `model` when it is a string, and `resolveSummaryModel` returns any present config string as-is. That means `{"model": 42}` silently becomes “no model configured” and falls back to the default, while `{"model": ""}` or whitespace can pass an empty model string through to the runner.

This reopens the same kind of silent config degradation the AUDIT-20260722-03 test block says it is closing. The blast radius is high because an unattended summarize run can use the wrong model or invoke the CLI with an invalid empty model despite a present config file. A reasonable fix is to fail loud when known keys are present with the wrong type or blank value, and add tests for non-string and blank `model`/`engine` config values.

### AUDIT-20260722-14 — validateSummaryRef is defined but nothing in the load path enforces it — dangling refs ship silently

Finding-ID: AUDIT-20260722-14
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/bibliography/summary-reference.ts:63-90 (and the absence of a call site in src/bibliography/load.ts:308-311)

The module's own docstring frames its purpose as SC-005 / Decision 5: "the reference must be resolvable, no dangling pointers." But `validateSummaryRef` is a pure opt-in helper — `loadSourceFile` (load.ts:308-311) reads `summaryRef` via `optionalString` and returns it without ever calling the validator, and no doctor/gate call site appears in this chunk or in any of the other chunk file-lists (none touch a doctor rule or reference `validateSummaryRef`). The integration test `tests/integration/summary-reference.test.ts` exercises the function in isolation, which does not prove it is wired into any real invariant.

The blast radius: a `source.yml` carrying a `summaryRef` whose artifact was renamed, moved, or never generated loads without complaint. The failure then surfaces downstream at render time — the site source page (`site/src/pages/sources/[sourceId]/index.astro`, another chunk) follows `summaryRef` to display the rollup and hits a missing file, or the operator simply never learns the pointer rotted. This is precisely the "no dangling pointers" invariant the file claims to uphold, left unenforced. A reasonable fix wires `validateSummaryRef` into a doctor rule (or `loadSourceFile` in a validating mode) so a dangling ref fails loud at check time, and adds a fixture proving a dangling ref is actually rejected by a wired path — not just by a helper nobody calls.

---

### AUDIT-20260722-15 — summaryRef validation can be escaped with `..` paths

Finding-ID: AUDIT-20260722-15
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/bibliography/summary-reference.ts:77-90; src/bibliography/load.ts:311-314

`summaryRef` is documented and written as an archive-relative pointer under `archiveRoot`, but the authoritative load/validate path does not enforce that invariant. `loadSourceFile` accepts any non-empty string at `summaryRef` (`src/bibliography/load.ts:311-314`), and `validateSummaryRef` then does `join(archiveRoot, ref)` plus `existsSync` (`src/bibliography/summary-reference.ts:77-90`). A hand-authored YAML value like `../some-existing-file.md` resolves outside the archive root and can still pass validation if the target exists.

This matters because downstream consumers can treat `validateSummaryRef` as proof that the bibliography pointer is a resolvable archive artifact, while it actually only proves that some filesystem path exists after normalization. The blast radius is high: a consumer acting on this as written can accept and later read a non-archive file through a trusted corpus metadata field, violating the feature’s stated “archive-relative path” and “resolves under archiveRoot” contract. A reasonable fix is to centralize summaryRef path validation for both loader-authored and helper-authored values: reject absolute paths, `..` traversal, and any normalized resolved path that is not contained within `archiveRoot`, with fixtures covering hand-authored YAML as well as `writeSummaryRef`.

### AUDIT-20260722-16 — Sidecar-only freshness can skip when the summary markdown is missing

Finding-ID: AUDIT-20260722-16
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/summarize/idempotency.ts:31-50, src/summarize/idempotency.ts:96-113

`checkArtifactFreshness` only receives and checks the companion YAML path. If `summary.concise.md.yml` and `summary.thorough.md.yml` exist with matching `input_layers`, but one of the actual markdown artifacts is missing or was deleted, `checkSummaryFreshness` returns `up-to-date` and `summarizeIssue` will skip generation. The comments explicitly define freshness as artifact/sidecar existence, but the implementation only verifies sidecars.

Blast radius is high because a downstream run can report an idempotent skip while the user-facing summary artifact is absent, leaving the site/browser surfaces without the markdown the feature is meant to produce. A reasonable fix is to pass both artifact path and YAML path into the freshness check and treat missing markdown as `fresh`/`stale` according to the same both-artifact rules.

### AUDIT-20260722-17 — Single-layer branch silently treats untranslated French OCR as an English-native source

Finding-ID: AUDIT-20260722-17
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/summarize/select-input.ts:171-190 (the `if (hasFrenchOcr)` branch), interacting with lines 52 (`FRENCH_OCR_FILENAME`) and 131-147

The function distinguishes a French source (OCR + translation) from an English-native source purely by the presence of `issue.en.txt`. In the single-layer branch (line 171), when only `issue.txt` exists, the code assumes it is "an English-language source's own OCR" (docstring line 149) and summarizes it directly. But the function receives *only* `issueDir` (a bare path string) — it has no access to the source's language metadata, so it cannot actually verify that assumption. The one signal it uses, absence of `issue.en.txt`, is also exactly the state of a **French source whose translation step has not yet run**.

The blast radius: in any incremental/interleaved pipeline run where OCR completes before translation, `selectSummaryInput` will return the raw French OCR text as `text`, the summarizer will build a summary from untranslated French input, and the artifact will be recorded as a normal success — no error, no low-confidence note (that note only fires on `ocr_quality.tier === 'low'`, unrelated to language). This is precisely the "fallback that hides a failure mode" the project guidelines and Principle XV posture forbid: a wrong-input summary produced silently rather than a fail-loud "translation missing." An unattended agent driving the pipeline would ship French-fed summaries for lagging French issues with nothing to catch it.

A reasonable fix: give the function an explicit source-language signal (metadata parameter or a marker file in `issueDir`) and, when the source is known-French but `issue.en.txt` is absent, fail loud ("translation pending — cannot summarize French source without its English translation") instead of falling through to the single-layer path. If the design genuinely guarantees translation-before-summarize, encode that guarantee as an assertion here rather than an unstated precondition.
