---
slug: 018-corpus-config-seam
targetVersion: ""
---

# Audit log — 018-corpus-config-seam

## 2026-07-29 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260729-01 — Snapshot side-effect fires BEFORE the atomic claim, so an EEXIST retry can overwrite the winner's metadata snapshot

Finding-ID: AUDIT-20260729-01
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/inventory.ts:259 (the `allocateMemberId` content callback) + src/sourcegroup/id-alloc.ts:128-133 (the retry loop)

`allocateMemberId`'s loop computes a candidate, then runs the caller's content callback, and only *then* attempts the exclusive create: `const body = typeof content === 'function' ? await content(candidate) : content;` followed by `writeFile(target, body, { flag: 'wx' })`. The exclusive create is the atomic claim, but the callback has already run and — per the in-diff comment at `inventory.ts` — has already performed an out-of-band write: *"The metadata snapshot's storage path is keyed by `sourceId` (`@/sourcegroup/snapshot`), so it can only be written once the candidate id is known."* So under concurrency the losing caller writes `snapshot(PB-P007)` for *its own* ark, gets `EEXIST` on `PB-P007.yml`, and retries at `PB-P008` — leaving a snapshot at the `PB-P007` path that belongs to a different ark than the `PB-P007.yml` record the winner just claimed. Depending on interleaving it either orphans a snapshot for an id the loser never owned, or clobbers the winner's snapshot after the winner wrote it.

Blast radius: a Port Breton source record whose `metadataSnapshot` ref resolves to metadata for a *different* archival object. That is silent provenance corruption in the SSOT — exactly the failure class the project constitution's Principle XV (no orphan assets, record must fully reflect the bytes) exists to prevent — and nothing fails loud when it happens. The retry path is not hypothetical: `id-alloc.test.ts` ships a 40-way concurrency test precisely because contention is expected, and the "content callback may be re-invoked" comment shows the authors knew the callback re-runs.

The guard that exists does not cover this. The 40-way test at `id-alloc.test.ts:88-95` uses a *pure* callback (`(allocated) => \`sourceId: ${allocated}\n\``), so it proves id uniqueness while being structurally blind to callback side effects; `inventory.test.ts` adds no concurrent-`runInventory` case at all. A reasonable fix: make the claim first (create `<id>.yml` with a placeholder/final-shape body under `wx`), and only after the claim succeeds run the id-dependent side effects and rewrite the file — or have `allocateMemberId` expose a post-claim `onClaimed(id)` hook distinct from `content`, and move `writeSnapshot` there. Either way, add a concurrency test in `inventory.test.ts` with a side-effecting callback that asserts no snapshot exists for an id the caller did not win.

---

### AUDIT-20260729-02 — The corpus seam is only half-wired: acquire / reconcile / verify-member / promote self-compose a committed-corpus policy instead of receiving the injected `CorpusComposition`

Finding-ID: AUDIT-20260729-02 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/cli/bib-sourcegroup-acquire.ts:196, src/cli/bib-sourcegroup-acquire.ts:416, src/cli/bib-sourcegroup.ts:115, src/cli/bib-sourcegroup.ts:153 (vs. src/cli/bib-inventory.ts:216)

`bib inventory` was converted to the seam properly: `runInventoryCli(rest: string[], corpus: CorpusComposition)` (bib-inventory.ts:216) receives the composed policy from the composition root and threads `corpus.sourceIds` / `corpus.sourceFilenames` into both the museum path (line 189-190) and the Gallica path (line 299-300). The doc comment even states the intent — "this module names no corpus-specific prefix/pad itself." Four sibling verbs in the same CLI family did *not* get that treatment. `runAcquireCli` (line 196), `runReconcileCli` (line 416), `runVerifyMemberCli` (line 115) and `runPromoteCli` (line 153) each reach out to `committedSourceFilenamePolicy()` — a zero-argument global that, by its own name, resolves *the committed corpora's* policy — rather than accepting the corpus the operator selected. Their signatures are unchanged, so the dispatcher has no way to pass a selection even if it wanted to.

Blast radius: this is exactly the property the feature claims to deliver ("second corpus, zero core edits", FR-004/FR-018). An operator who selects a non-committed or non-default corpus and then runs `bib acquire` / `bib reconcile` / `bib verify-member` / `bib promote` gets one of two wrong behaviors depending on what the bootstrap resolves to. If it resolves the *default/Port-Breton* corpus, `loadAllSources` is enumerated under the wrong filename grammar and the second corpus's sources either fail to load or are misparsed — the acquire path then fails at `registerMemberArchiveLayout` (line 55-62) with "unknown sourceId", which reads as a data problem, not a selection problem. If instead it unions every committed corpus's policies, these verbs become override-blind: `--corpus` is accepted and silently ignored, and a member from corpus A is happily acquired while corpus B is selected. Either reading is a defect, and the diff contains nothing that pins which one holds.

A reasonable fix is to give these four `runXCli` functions the same `corpus: CorpusComposition` parameter `runInventoryCli` now takes and delete the `committedSourceFilenamePolicy()` import from both files, so the bootstrap survives only where there is genuinely no selection (i.e. `bib validate-config`). If the deviation is deliberate, it needs an explicit in-code deviation note naming the invariant and why these verbs are the in-scope exception — the current comment ("composed ONCE here and threaded into every helper below") documents the *mechanics* of the bypass without justifying it.

### AUDIT-20260729-03 — `selectedCopyHasRecordedAssets` converts a new config-driven throw into a silent reconcile misroute

Finding-ID: AUDIT-20260729-03
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/cli/bib-sourcegroup-acquire.ts:352-370, called at :417

`selectedCopyHasRecordedAssets` is a *routing predicate*: its boolean return decides at line 417 whether `runReconcileCli` takes the museum/B2 branch or the Gallica/ark branch. The diff changes its body from `loadAllSources(sourcesDir)` to `loadAllSources(sourcesDir, sourceFilenames)` (line 360) inside the `try {` at line 358, and the function's only visible exits are `return false`. The whole point of the new second argument is that `loadAllSources` now *enforces* a filename grammar — so this call has gained a brand-new throw channel that did not exist before the diff: a source file whose name does not match the injected policy, or a policy that fails to compose, now raises inside a `try` whose failure path (per the two visible `return false` exits and the absence of any rethrow in the hunk) is "not a museum copy."

Blast radius: the operator gets no error at all. `bib reconcile` proceeds down the ark branch, calls `registerMemberArchiveLayout` (line 436) and `runReconcile` with a completely different set of assumptions, and either fails much later with an unrelated-looking message or — worse — reconciles the wrong way and leaves the SSOT record advanced against the wrong copy. Per the project's own standing rule ("never implement fallbacks... errors let us know that something isn't implemented"), a caught-and-downgraded exception on a routing decision is a bug factory, and this diff is what put a *configuration* failure onto that path. The fix is to narrow the catch to the case it was written for (source not present / no recorded assets) and let a policy/parse failure propagate to the caller's error handling at line 419, where `describeError` and exit 2 already exist. If the catch body genuinely rethrows, this finding collapses — but nothing in the diff shows that, and the two visible `return false` exits establish the swallow-shaped contract.

### AUDIT-20260729-04 — Next-ID prediction reads declared `sourceId`s while the allocator reads filenames — a real collision passes validation silently

Finding-ID: AUDIT-20260729-04 (claude-01 + claude-06 + codex-01 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/corpus/validate-existing-data.ts:~103-121 (`namespaceSuffix`), ~248-300 (`nextIdFindings`); src/corpus/source-index.ts:~111-155 (`readIdentity`)

`namespaceSuffix`'s doc comment claims the prediction is allocator-faithful: *"Deliberately accepts ANY digit count, not just `padWidth` — this mirrors `@/sourcegroup/id-alloc`'s `^PB-P(\d+)\.yml$` scan, so the next-id computation here predicts the same id the allocator would actually pick."* But the two scans read different data. The allocator's regex matches **filenames**; `nextIdFindings` computes `max` from `entry.sourceId`, and `source-index.ts` deliberately never looks at the filename at all (`readIdentity` reads only `parsed.sourceId` / `parsed.case`; `filePath` is carried "for locating error messages"). Nothing in this diff asserts that a record's filename agrees with its declared `sourceId`, so the mirror claim only holds when they happen to agree.

Concrete false negative: two files, `PB-P001.yml` declaring `sourceId: PB-P001`, and `PB-P002.yml` declaring `sourceId: PB-P003`. The allocator scans filenames, sees max suffix `002`, and mints **`PB-P003`** — which is already claimed by an existing SSOT record. `nextIdFindings` sees ids `{PB-P001, PB-P003}`, computes `max = 3`, predicts `PB-P004`, finds it free in `allIds`, and emits no finding. The repository validates clean and the next acquisition writes a second record claiming `PB-P003` — exactly the archive corruption `next-source-id-collision` exists to prevent, and exactly the kind of orphan/ambiguous-identity state the project constitution's Principle XV treats as a defect. Blast radius: an unattended agent running `bib validate-config` gets a green light on a repository that is one allocation away from a duplicate Source ID, and the duplicate is only discovered later by `duplicate-source-id` — after the bytes are written.

A reasonable fix is to add a `source-filename-id-mismatch` rule: `SourceIdentity` already carries `filePath`, so `validateExistingData` can compare `basename(filePath)` against `` `${sourceId}.yml` `` and emit a finding on divergence. That both closes the false negative and makes the "mirrors the allocator" claim true by construction, rather than by coincidence. If filename↔id agreement is deliberately out of scope for this module, the `namespaceSuffix` comment must stop asserting allocator-fidelity, since a reader (or agent) will otherwise rely on it.

### AUDIT-20260729-05 — Override collision detection only compares override-against-override, so an override aimed at another Source's *generic* location passes validation

Finding-ID: AUDIT-20260729-05 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/corpus/validate-overrides.ts:14-16, 74-75, 143-167

The module header states the guarantee explicitly: every override must prove that it "(d) does not collide with another Source's location" (line 16), and the `override-duplicate-location` message asserts the invariant in absolute terms — "two Sources must never share one location". But the implementation only ever populates `claimants` from override `relativePath`s (`claimants.set(location, [subject])`, ~line 147), and only reports a finding when `subjects.length > 1`. The far larger population — every Source whose archive location comes from the *generic* layout rule — is never entered into `claimants`, and the function never computes a generic location for anything. An override whose `relativePath` happens to equal the location the layout rule derives for a different Source is therefore accepted silently.

This is the failure mode overrides exist to create. The header itself calls `relativePath` "the most dangerous field in the manifest: it names a filesystem location by hand"; the *only* thing hand-naming a path can collide with, in a corpus where most Sources are placed by rule, is a rule-placed Source. Concretely: corpus `PB` places Sources at `<caseId>/<sourceId>/`, and an operator authors an override for `PB-P012` with `relativePath: "port-breton/PB-P007"` to point at a legacy directory. `PB-P007` is rule-placed at exactly that path, holds no override, and so never enters `claimants`. `validateArchiveOverrides` returns zero findings, `bib validate-config` reports ok, and two Sources' masters land in one archive directory — the precise state INV-10 forbids and the state a downstream acquisition (Principle XV, no orphan assets) will happily write into.

Blast radius: a config the validator green-lights produces silent archive-layout aliasing, and the operator's evidence that it is safe is a passing `validate-config`. Two reasonable fixes: (1) inject the layout resolver (the same seam T013/T024 already established for `SOURCE_LAYOUTS` retirement) and seed `claimants` with the generically-derived location of every `SourceIdentity` in `entries` before walking overrides — the identity index is already a parameter, so the data is in hand; or (2) if computing generic locations here is deliberately out of scope, state the boundary as an invariant rather than an omission — amend line 16 to say the checked invariant is *override-vs-override* disjointness, name generic-vs-override as the uncovered channel, and file it. What is not acceptable is a doc comment claiming (d) while the code checks a strict subset of (d).

---

### AUDIT-20260729-06 — `validate()` silently skips the search-log scope check when `validCaseIds` is omitted — a check that used to run unconditionally

Finding-ID: AUDIT-20260729-06 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    `src/bibliography/validate.ts:~280` (hunk `@@ -266,8 +277,8 @@`), with `src/bibliography/validate-search-log.ts:50-59`

The gate changed from

```ts
if (opts?.searchLog !== undefined && opts?.repoRoot !== undefined) {
```

to

```ts
if (opts?.searchLog !== undefined && opts?.repoRoot !== undefined && opts?.validCaseIds !== undefined) {
```

The new third conjunct converts a *missing dependency* into a *skipped safety check*. Every pre-existing caller that supplies `searchLog` + `repoRoot` — and there is at least one shipped one, plus whatever tests exercise this path — keeps compiling (the field is `validCaseIds?:`), keeps returning `ValidationFinding[]`, and now returns findings computed over one fewer check. Nothing in the return value distinguishes "search-log scopes were resolved and all were valid" from "search-log scopes were never resolved." That is the exact fallback-that-hides-a-failure-mode shape the project's own guidance forbids, and the docblock added directly above it (`"omitting it (like omitting either of the other two) simply skips the check rather than defaulting to any corpus's ids (FR-004, no fallback)"`) argues the *absence of a default* is the no-fallback property — but the fallback here isn't a default corpus, it's a silently vacuous pass.

Blast radius: a dangling `{kind:'case'}` scope in `bibliography/search-log.yml` (a typo'd case slug, or a slug belonging to a corpus that was renamed/removed) ships green through `bib validate`. Referential integrity of the search log is a load-bearing invariant for the whole acquisition record, and this is precisely the check that guards it. The failure is invisible: green output, no warning line, no "checks skipped" note. Contrast the sibling `validCaseIds` treatment in `resolveScopeRef` (`scope.ts:99`), which correctly fails loud on an *empty* set — only `undefined` degrades.

Reasonable fix: make the trio all-or-nothing and loud. If `searchLog !== undefined && repoRoot !== undefined && validCaseIds === undefined`, `throw` naming the missing option, rather than falling through the `if`. Alternatively hoist the three into a single required sub-object (`scopeCheck?: { searchLog, repoRoot, validCaseIds }`) so the type system makes a partial supply unrepresentable — which is strictly better, since it also removes the reader's need to know that three independent optionals are secretly one unit.

---

### AUDIT-20260729-07 — Coverage report unions Sources across all corpora but narrows case ids to the selected corpus — over a *global* search log

Finding-ID: AUDIT-20260729-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `src/bibliography/coverage/load-coverage-report.ts`, final hunk (`const sources = loadAllSources(sourcesDir, unionSourceFilenamePolicy(manifests));` … `validCaseIds = selectedCorpus !== undefined ? deriveScopeContext(selectedCorpus).validCaseIds : deriveAllCaseIds(manifests)`)

Inside one function, two policies derived from the same `manifests` read are scoped in opposite directions, and the module's own doc comment states both rationales without noticing they collide:

- `sources` — **union**, justified explicitly: *"`bibliography/sources` holds every corpus's Source files … the page itself is documented to render the whole committed bibliography, unscoped to any one corpus."*
- `validCaseIds` — **narrowed to `selectedCorpus`** when the browser build supplies one.

The third input, `searchLog`, is loaded from a single global path (`bibliography/search-log.yml`) with no corpus scoping at all. So once a second corpus exists — which is exactly what T016/T017 in this same feature commit fixtures for — the coverage build renders corpus B's Sources and reads corpus B's search-log entries, while resolving `{kind:'case'}` scopes against corpus A's case ids only. Every corpus-B case-scoped search-log entry resolves against a set that cannot contain it. Depending on how `buildCoverageReport` consumes `validCaseIds`, that surfaces either as spurious "invalid/dangling scope" findings on the public coverage page, or as those entries being dropped from coverage attribution — a false negative in the one artifact whose job is to report what's been searched.

The doc comment even flags the tension in the case-id direction ("*a union that is behavior-identical with one committed corpus but WRONG once a second exists*") but resolves it in favor of narrowing, while resolving the identical question for `sources` in favor of unioning. Both readings can't be right about the same page. Blast radius is a wrong operator-facing coverage claim on a public build, with no error to signal it.

Fix: pick one scoping story for the whole report and enforce it in the type. Either (a) the page is corpus-unscoped — then `validCaseIds` is the union unconditionally and `selectedCorpus` should not influence it (drop the parameter's effect on this field), or (b) the page is corpus-scoped — then `sources`, `searchLog`, and `validCaseIds` must *all* be filtered to the selection, and the union path becomes an error rather than a documented default. Whichever is chosen, a fixture with two committed manifests and a case-scoped search-log entry from the non-selected corpus is the regression that pins it.

---

### AUDIT-20260729-08 — The coverage page mixes two corpus scopes in one render, and needs a core edit the moment a second corpus lands

Finding-ID: AUDIT-20260729-08
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    site/src/pages/coverage/index.astro:41-60

The page now makes two data loads with *deliberately opposite* corpus scoping. Line 44 binds the coverage report to one selection — `loadCoverageReport(repoRoot, selectedCorpus)` — while lines 56-60 deliberately refuse that binding for the title enumeration, and the comment at lines 50-55 states the reason outright: "binding this enumeration to one selection would silently drop a second corpus's Sources the moment one exists." Both halves render into a single `/coverage` route that carries no corpus dimension in its URL and is built from a single build-time `COLONY_CORPUS` (netlify.toml:22). These two design goals cannot both hold: the page is simultaneously asserted to be corpus-bound (the report) and corpus-neutral (the titles).

The consequence is concrete at the exact moment feature 018 succeeds. When corpus B is added under `corpora/`, one Netlify build selects corpus A; `/coverage` then renders corpus A's coverage report and search-log case scope, while `titleById` is populated from corpus A *and* B's Source files. Titles for B's sources are loaded and then either dropped on the floor (best case, wasted work) or attached to rows the A-scoped report did not scope-check (worst case, a page that silently presents cross-corpus data as one corpus's coverage). Neither outcome is visible on the rendered page, and no test in the barrage covers it — `tests/integration/corpus/second-corpus.test.ts` (other chunk) exercises the CLI/library seam, and Astro page modules are not in the unit surface. This directly undercuts the feature's headline claim in commit `1a932dc` ("second-corpus proof, zero core edits"): this file *is* core, and it needs an edit.

Blast radius: a public-facing data page whose scope silently becomes incoherent at second-corpus time, with no failing test and no runtime error to signal it — the failure mode is a plausible-looking wrong page, which is why I rate it high rather than medium. A reasonable fix is to make the scope decision explicit and singular: either give the route a corpus segment (`/coverage/[corpus]`) and scope both loads to it, or keep the page federated and scope *neither* load, passing the set of all installed corpora to `loadCoverageReport` so the search-log case scope is the union too. Silently splitting the two is the one option that cannot be right.

---

### AUDIT-20260729-09 — `committedSourceFilenamePolicy()` is used to justify second-corpus safety, but a "committed"/bootstrap policy is exactly what cannot see a second corpus

Finding-ID: AUDIT-20260729-09
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    site/src/pages/coverage/index.astro:50-59 (import at :22; impl at src/corpus/source-filename-bootstrap.ts, other chunk)

Line 59 passes `committedSourceFilenamePolicy()` — imported from `@/corpus/source-filename-bootstrap` — into `loadAllSources` on the production site-build path, and the comment at lines 50-55 justifies it as the second-corpus-safe choice: it "reads every corpus's Source files … binding this enumeration to one selection would silently drop a second corpus's Sources the moment one exists." That rationale only holds if the returned policy is *derived* from the set of installed corpus manifests. The module's name says the opposite: `source-filename-bootstrap`, returning the *committed* policy. If it is a constant describing the filename shapes present in the repo today (the natural reading of both "bootstrap" and "committed"), then a second corpus that adopts a filename shape the constant does not enumerate is dropped — precisely the failure the comment claims to prevent. The mechanism would be self-defeating with respect to its own stated purpose.

This also sits uncomfortably against the feature's own thesis. Feature 018 exists to move per-corpus constants out of code and into `corpora/*.yml`, and the barrage includes a `tests/unit/corpus/no-legacy-constants-guard.test.ts` plus `tests/support/scan-production-src.ts` (other chunks) to enforce that. A bootstrap module holding a hardcoded filename policy, consumed from a production Astro page, is a constant re-entering through a side door; whether the guard exempts `source-filename-bootstrap.ts` is not visible from this chunk, and if it does, that exemption is a hole in the guard rather than a clean result. Note also the project's standing rule against fallbacks outside test code — a "committed" default that stands in for a derived value is structurally a fallback.

I could not open `source-filename-bootstrap.ts` (no read tooling in this session), so this is a forced disjunction rather than a demonstrated defect, and both branches are findings: either the function derives the union from installed manifests, in which case the name actively misleads every future reader and should become something like `allInstalledCorporaFilenamePolicy()`; or it is a committed constant, in which case the comment's second-corpus rationale is false and the correct fix is to enumerate `corpora/*.yml` and union their declared `sourceFilenames` policies. Blast radius under the second branch: a second corpus's Sources silently render with bare ids instead of titles on the public coverage page, with a comment in the code asserting that exact outcome was designed against — the kind of quietly-wrong reading an unattended agent maintaining this page would build on rather than question.

---

### AUDIT-20260729-10 — Browser-profile `defaultSources` are type-checked but never checked against the corpus's own source-id policies — and the new fixtures encode ids no policy can allocate

Finding-ID: AUDIT-20260729-10
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/fixtures/corpora/an-arbitrary-place/zzz-custom.browser.yml:5, tests/fixtures/corpora/an-arbitrary-place/zzz-custom.yml:5-8, tests/fixtures/corpora/browser-profile-cases/valid.browser.yml:4-6

`zzz-custom.yml:5-8` declares exactly one source-id policy — `prefix: ZZ`, `padWidth: 5`, `allocatable: true`. Under the FR-019 grammar as settled by commits `13db584` ("drop trailing-delimiter rule from source-id prefix grammar") and `4978037` (prefix may itself contain a hyphen, e.g. `PB-P`), the only ids that corpus can ever allocate are `ZZ` + five padded digits — `ZZ00001`. Its paired browser profile at `zzz-custom.browser.yml:5` declares `defaultSources: [ZZ-00001]`, which no policy in that manifest can produce. The same mismatch runs through the whole browser-profile fixture family: `valid.browser.yml:4-6` uses `AL-001`/`AL-002` and `bad-default-sources-entry.browser.yml:5` uses `AL-001`, while the sibling `alpha` source fixtures listed in chunk `33c09f07a76d3032` are `tests/fixtures/sources/validate-valid/AL001.yml` and `AL002.yml` — unhyphenated.

The negative fixtures added here cover the *type* channel thoroughly (`bad-default-sources-not-array` = scalar, `bad-default-sources-entry` = a non-string `42`, `missing-default-sources` = absent), and nothing else. There is no fixture anywhere in the inventory exercising the *referential* channel — "a `defaultSources` entry names an id this corpus's policies cannot allocate, or that no source record exists for." The two profile-validation negative fixtures that do exist are `validate-duplicate-profile-id/` and `validate-profile-unknown-corpus/`; a `validate-profile-unknown-default-source/` has no counterpart. That is the coupling point this feature exists to close: a corpus manifest owns the id grammar, and the browser profile names ids under it, but nothing welds the two.

Blast radius: an operator (or an unattended agent copying `valid.browser.yml` as the authoring template) writes `PB-00001` where the corpus allocates `PB00001`. `bib validate-config` (T018) reports clean, startup validation passes, and the browser's default view renders empty with no diagnostic — a silent wrong result rather than a loud failure, which is precisely the failure mode Principle XV-style welding is meant to prevent. Disambiguating check: grep `src/corpus/validate.ts` for `defaultSources`. If no cross-check against the resolved source index exists, this is the missing rule and the fix is to add it plus a `validate-profile-unknown-default-source` fixture. If the rule *does* exist, then these two positive fixtures (`zzz-custom.browser.yml`, `valid.browser.yml`) would violate it and are therefore reaching only the structural loader — so the fixtures should be corrected to real allocatable ids so they stop teaching the wrong shape.

### AUDIT-20260729-11 — The deferred source-filename composition root unions *every* committed corpus, so the moment a second corpus is committed ~half the call sites silently enumerate both corpora's Sources

Finding-ID: AUDIT-20260729-11
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `src/corpus/source-filename-bootstrap.ts:24-40, 75-85, 100-116`; test gap at `src/corpus/source-filename-policy.test.ts:129-140`

`unionSourceFilenamePolicy` (lines 75-85) folds the `sourceIds` of *all* manifests into one predicate, and `committedSourceFilenamePolicy` (100-116) feeds it `listCorpusManifests(corporaRoot)` — i.e. every manifest in the repository. The module's own doc (lines 24-32) names the consumers on this path: the fetch-source guardrail (`sourceKind`), the acquire/reconcile/promote pipeline, and the PDF batch builder. The justification given is "today `loadAllSources` enumerates all 94 Port Breton records regardless of `--corpus`, and FR-010 requires that stay true." That justification holds *only while exactly one corpus is committed* — and the entire point of this feature is to make that false. The instant `corpora/second.yml` lands, those call sites begin treating corpus B's `SYN-001.yml` as an in-scope Source with no flag, no warning, and no way for the call site to say "only the selected corpus." The prior hardcoded `/^PB-[A-Z]?\d{3}\.yml$/` was corpus-coupled but at least *bounded*; the replacement is unbounded in the opposite direction, and the failure mode (an acquire/reconcile pass silently operating across corpora) is exactly the quiet-wrong-answer class this spec exists to eliminate.

Blast radius: an operator or unattended agent commits the second manifest — the feature's headline deliverable — and reconcile/inventory/PDF-batch runs mix corpora with no error surface. Detection depends on someone noticing record counts, which is precisely what nobody checks on a green run.

Nothing in this chunk exercises the two-committed-corpus state. The union test at `source-filename-policy.test.ts:129-140` builds the union from two *inline* manifest literals and asserts only the predicate's booleans; `SC-003`'s second-corpus proof goes through `installSourceFilenamePolicy` with fixtures, which bypasses `listCorpusManifests` entirely. So the one state transition that changes this module's behavior has no fixture. A reasonable fix is to give the deferred entry point a corpus-scoped form (`committedSourceFilenamePolicy(corpusId)`) that the call sites which *can* name a corpus use, keep the union only where cross-corpus enumeration is genuinely intended, and add a fixture with two manifests on disk under a fixture corpora root that pins which of the two behaviors each call site gets.

---

### AUDIT-20260729-12 — `stripComments` desyncs on regex literals — the doc certifies a property the scanner does not have

Finding-ID: AUDIT-20260729-12
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/support/scan-production-src.ts:20-31, 101-134

The module doc (lines 24-27) asserts: *"so a `//` or `/*` inside a string or **regex literal** is never mistaken for a comment start, and a genuine comment is never left un-blanked because of some quoting edge case."* That claim is false for regex literals, and for exactly the reason the author already discovered for templates. `ts.createScanner(...).scan()` never emits `RegularExpressionLiteral`; on `/` it checks only for `//`, `/*`, `/=` and otherwise returns `SlashToken`. Producing a regex token requires `scanner.reScanSlashToken()` — the precise sibling of the `reScanTemplateToken()` call the author *did* add at line 122. The template channel was hardened; the identical slash channel was not, while the doc certifies both.

Consequences, all silent: (a) a regex whose body contains a quote — `/['"]/`, `/won't/` — opens a bogus string literal that the scanner runs to end-of-line, swallowing any trailing `// comment` so it is never blanked (guard sees prose as live code → spurious failure); (b) a regex containing `/*` inside a character class (`/[/*]/`) starts a real `MultiLineCommentTrivia` that blanks live code until the next `*/` — the guard goes **blind over that span**, the exact false-negative the line-93 comment claims to have eliminated; (c) an unbalanced brace inside a regex (`/\{/`, `/}/`) corrupts `braceDepth`, so the `top === braceDepth` test at line 118 stops matching and the *next* template substitution desyncs every token after it. Blast radius: these guards are the only mechanism enforcing SC-004/FR-012/FR-016 — a hole means a reintroduced retired constant ships green, and nothing else in the feature catches it. Fix: call `reScanSlashToken()` when a `SlashToken`/`SlashEqualsToken` appears in regex-legal position (or, more robustly, drop the hand-rolled token walk and use `ts.createSourceFile()` + `ts.forEachChild` with `ts.getLeadingCommentRanges()`, which handles regex, template, and JSX trivia without a bespoke state machine), and add a direct unit test for `stripComments` with fixtures covering regex-with-quote, regex-with-`/*`, regex-with-brace, nested template, and tagged template.

---

### AUDIT-20260729-13 — The INV-16 silent-empty channel is still open: a policy that matches zero files still enumerates zero Sources with no error

Finding-ID: AUDIT-20260729-13
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/unit/bibliography/load-source-filename-policy.test.ts:15-24, :78-95; tests/unit/bibliography/load-coverage-report.test.ts:150-166

The file's own header states the defect being fixed: "Its failure mode was SILENCE: a second corpus's `SYN-001.yml` did not match, so enumeration returned zero Sources with NO error, and any check built on that list passed vacuously." The fix makes the pattern *injectable* — but nothing in this chunk makes the **zero-match** outcome fail loud. Every enumeration test in the new file leaves at least one matching file on disk (`['SYN-001','SYN-002']`, `['PB-P001','PB-S001']`, `['PB-P001']`, `['PB-P001','SYN-001']`). There is no fixture for "injected policy matches nothing," so the vacuous-pass shape the file claims to have killed is untested and, by the evidence here, unchanged: it has merely moved from a hardcoded regex to a mis-threaded `selectedCorpus`.

The coverage-report test demonstrates the live instance. At :158-166 it calls `loadCoverageReport(dir, selectedAlpha)` against a sources directory seeded exclusively with Port Breton fixtures (`cpSync(FIXTURES_SOURCES_DIR, sourcesDir)`, :153). Under alpha's selection the Source-filename policy is alpha's prefixes, so `loadAllSources` enumerates **zero** Sources on that directory — silently. The test passes because it asserts a *search-log case-id* throw that fires for an unrelated reason; the empty-source-set is never observed or asserted on either way. Note the asymmetry the diff itself documents at :31-38 of load-coverage-report.test.ts: a repo root with *no manifests* "fails loud rather than enumerating nothing", but a repo root with manifests that match *no files* does not.

Blast radius: an operator selects the wrong corpus (or a caller threads a `selectedCorpus` that doesn't match what's on disk after a prefix rename) and every downstream coverage, validation, and doctor check runs over an empty Source list and reports clean. That is a false green on the SSOT's primary integrity surface, with no error to notice — exactly the class the project's no-fallbacks commandment exists to prevent. A reasonable fix: make `loadAllSources` (or its caller) throw when a non-empty directory yields zero policy-matching Sources while unmatched `.yml` files are present, and add the fixture that pins it.

---

### AUDIT-20260729-14 — "Behavior preservation" assertion is one-directional; the new two-prefix policy is strictly narrower than the retired pattern and the guard cannot see the narrowing

Finding-ID: AUDIT-20260729-14
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/bibliography/load-source-filename-policy.test.ts:117-128

The retired filter is stated as `^PB-[A-Z]?\d{3}\.yml$` (:18-19) — which matches `PB-001.yml` (no letter) and all 26 of `PB-A001.yml`…`PB-Z001.yml`. The replacement policy derived from the manifest is two prefixes only, `PB-P###` + `PB-S###` (:30). The new policy is therefore **strictly narrower** than the one it replaces, across 25 unexercised shapes.

The test that claims to guard this cannot detect the narrowing, because its assertion runs the wrong direction:

```ts
expect(ids.every((id) => /^PB-[A-Z]?\d{3}$/.test(id))).toBe(true);
```

with the comment "The retired pattern's own result, pinned: nothing else in the directory was ever enumerated." That checks only that *everything the new policy enumerated* would also have been matched by the old pattern — i.e. it detects **widening**. Behavior preservation against a retirement needs the opposite check: that everything the *old* pattern matched is still enumerated. A file named `PB-001.yml` or `PB-A001.yml` was a Source under the retired code and is silently dropped under the new one, and this suite stays green. The `expect(ids).toHaveLength(94)` line masks this today only because no such file happens to exist right now — it is a data coincidence, not a guard.

Blast radius: a Source that was in the corpus before this feature disappears from enumeration with no error (compounding finding-01's silence), and the test explicitly labelled "behavior preservation against the REAL committed SSOT (FR-010)" certifies the change as behavior-preserving when it is not. Fix: assert set equality between `loadAllSources(REAL_SOURCES_DIR, portBretonPolicy())` and the directory listing filtered through the retired regex — a characterization test in both directions — and, if the narrowing is intentional, state the invariant (the manifest is authoritative; the old regex's unclaimed shapes are out of scope because no manifest declares them) rather than leaving the one-directional check standing in for it.

---

### AUDIT-20260729-15 — The unselected `loadCoverageReport` path silently unions across every corpus, and this diff pins that fallback as expected behavior

Finding-ID: AUDIT-20260729-15
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=reachable, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/unit/bibliography/load-coverage-report.test.ts:104-167 (assertion at :155-156)

The new test's own docstring diagnoses the defect precisely (:105-114): the union across every manifest "is behavior-identical with one committed corpus, but which a second corpus makes **WRONG** (a case-scope entry naming corpus A's case would validate under corpus B's own selection purely because A and B share one `bibliography/sources` directory)." The test then seeds exactly that second corpus and asserts the wrong behavior is retained:

```ts
// No selection: the union spans BOTH manifests, so 'port-breton' ... is a valid case id
expect(() => loadCoverageReport(dir)).not.toThrow();
```

So the optional-`selectedCorpus` parameter is a permissive default: forget to thread it at one call site and you get cross-corpus validation that passes on data belonging to a different corpus, with no diagnostic. `committedSourceFilenamePolicy()` (referenced at :10 of load-source-filename-policy.test.ts) is the same shape on the filename seam — a "just use whatever is committed" default available to any caller that hasn't been wired.

This is the fallback pattern the project instructions forbid ("Never implement fallbacks... Throw errors with a description of the missing functionality instead. Fallbacks... are bug factories"). Blast radius: the feature's entire stated goal is a corpus config seam; the moment a second corpus lands, every un-audited call site quietly validates against the union and reports clean on wrong-corpus data — and because this test asserts `.not.toThrow()`, a future contributor who *tightens* the default to fail-loud will be told by CI that they broke something. The correct shape is a required `selectedCorpus` (compile-time, as FR-018 did for `SourceFilenamePolicy` — see finding-04) with the union available only as an explicitly-named argument; if the union genuinely must stay reachable, the test should assert it under an explicit `unionAcrossCorpora()` argument rather than under the *absence* of one.

---

### AUDIT-20260729-16 — Handlers receive an injected `CorpusComposition` and then discard it in favour of a module-global `committedSourceFilenamePolicy()`

Finding-ID: AUDIT-20260729-16 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    `src/cli/fetch-source.ts:52-53`, `src/cli/ocr.ts:93-97`, `src/cli/restore-images.ts:65-69`, `src/cli/dispatch.ts` (the `Handler` type)

`dispatch.ts` redefines the handler contract as `type Handler = (args: ParsedArgs, corpus: CorpusComposition) => Promise<void>` and documents the second parameter as "the INJECTION POINT established by T009 (FR-004) … it is always a real composition here — never `null`, never optional." The composition root then unconditionally builds that composition for every `HANDLERS` verb and passes it in. In the same diff, three of those very handlers — `runFetchSource`, `runOcr`, `runRestoreImages` — ignore the injected parameter and instead reach sideways for a module-global:

```ts
if (sourceKind(sourceId, sourcesDir, committedSourceFilenamePolicy()) === 'source-group') {   // fetch-source.ts:53
ensureMemberLayoutRegistered(sourceId, …, committedSourceFilenamePolicy());                   // ocr.ts:93-97, restore-images.ts:65-69
```

FR-018 declares `SourceFilenamePolicy` the fifth coupling point, and commit `1834ee2` claims it was closed by injecting the policy into `loadAllSources` (T023). These three CLI call sites are the same coupling point, un-closed, at the outermost layer — the one place the corpus is already in scope. The name `committedSourceFilenamePolicy` in `@/corpus/source-filename-bootstrap` reads as "the policy of the committed (Port Breton) corpus," i.e. a corpus-independent constant. If so, the blast radius is a silent wrong answer, not a crash: `bib --corpus synthetic ocr …` composes the synthetic corpus, then classifies source ids and registers member layouts under Port Breton's filename grammar. `sourceKind` returning the wrong kind flips `runFetchSource` between the source-group redirect error and a real fetch. Nothing fails loud, so an unattended agent gets a plausible-looking result computed against the wrong corpus. Note that the T017 "second-corpus proof, zero core edits" test evidently does not exercise `ocr` / `restore-images` / `fetch-source`, or this would have surfaced.

The fix is to thread the policy off the injected composition (`corpus.sourceFilenamePolicy`) at all three sites and delete the `committedSourceFilenamePolicy` import from `@/cli`, leaving the bootstrap for genuine pre-composition callers only. **Kill condition:** if `committedSourceFilenamePolicy()` is provably corpus-invariant *by construction* (FR-019's corpus-neutral source-id grammar), this drops to `medium` — a shape problem rather than a wrong-answer problem — but it should then be a documented Principle VI deviation alongside the T013 archive-layout one (`fe06535`), and that deviation note covers archive layout, not filename policy.

---

### AUDIT-20260729-17 — `installedCapabilities()` reads a side-effect-populated registry with no guaranteed import, so `bib validate-config` can compute an empty capability set

Finding-ID: AUDIT-20260729-17
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `src/cli/installed-capabilities.ts:1-2, 38-43`

The module's own doc comment names the hazard without closing it: `sourceQueries` comes from "a genuine read of `@/sourcequery/source-config`'s live `sourceRegistry`, **whose entries are added by `registerSource` at import time**." But `installed-capabilities.ts` imports only the module that *declares* the registry:

```ts
import { registeredSourceQueryIds } from '@/sourcequery/source-config';
```

It does not import the modules that *call* `registerSource`. So `installedCapabilities().sourceQueries` returns whatever happened to be loaded by the time `bib validate-config` reaches it — a value that depends on the import graph of an unrelated code path. The asymmetry with the other half is the tell: `repositories` reads `REPOSITORY_NAMES`, a static exported array that cannot be partially initialised; `sourceQueries` reads mutable global state. Two different reliability classes behind one function that presents them as equivalent.

This gets sharper under the bundle. `dispatch.ts`'s own comment confirms the CLI ships as "the esbuild bundle" — and side-effect-only registration modules with no value import are exactly what a bundler's tree-shaker is entitled to drop. The failure mode is a false negative in the gate this feature was built to add: `validate-config` rejects a committed manifest whose `requiredCapabilities` names a source query that *is* installed, and the operator's only recourse is to delete a correct line from a correct manifest. If the registry comes back empty, every manifest naming any source query fails at once — a CI-red event with a misleading message. A reasonable fix is to import the registration barrel explicitly here (with a comment saying the import is load-bearing for its side effect), or better, mirror `REPOSITORY_NAMES` and export a static `SOURCE_QUERY_IDS` from the registration site. Either way this needs a fixture asserting `installedCapabilities().sourceQueries` is non-empty and contains the known shipped ids — run against the **bundled** artifact, not just the tsx source, since that is where the two diverge.

---

### AUDIT-20260729-18 — `--corpus` is accepted, validated, and then thrown away by the `translate` bin's handlers

Finding-ID: AUDIT-20260729-18
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/translate-dispatch.ts:30-41, 127-135; src/cli/translate.ts:146-150, 272-284

`translate-dispatch.ts` is presented as the T009 composition root: it strips `--corpus`, resolves `corporaRoot`, reads `COLONY_CORPUS`, and calls `composeCorpus(...)` — and then hands the result to a handler that discards it. Both entries in `HANDLERS` drop the second parameter outright (`translate: (args) => runTranslate(args)`, `'translate-source': (args) => runTranslateSource(args)`), and the leaf functions re-derive everything from global state: `runTranslate` builds its sources dir as `path.join(process.cwd(), 'bibliography', 'sources')` (translate.ts:148) and `runTranslateSource` does the same at line 274, then obtains its filename policy from `committedSourceFilenamePolicy()` rather than from the composed corpus.

The consequence is that for this bin, `translate --corpus alpha …` and `translate --corpus beta …` do exactly the same work on exactly the same paths. The only observable difference between corpora is whether selection/validation throws. The header comment even asserts why these verbs are corpus-dependent — "they compute archive paths and write translation provenance" — which is precisely the computation that still ignores the corpus. Blast radius: an operator (or an unattended agent) reasonably concludes from the help text and the required flag that `--corpus beta` scoped the run; translation provenance and archive writes land under whatever the ambient cwd/committed config says. The T017 "second-corpus proof, zero core edits" claim does not extend to this bin. A fix threads `corpus` into `runTranslate`/`runTranslateSource` as a parameter (sources dir + filename policy + archive layout from the composition), or — if that threading is genuinely out of this feature's scope — the bin should not advertise `--corpus` as required, because a required flag with no effect is worse than an absent one.

---

### AUDIT-20260729-19 — `committedSourceFilenamePolicy()` is an ambient global read that bypasses the injected corpora root

Finding-ID: AUDIT-20260729-19
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/cli/translate.ts:6, 148, 275, 283; src/cli/summarize.ts:5, 158, 327

T023 injected `SourceFilenamePolicy` into `loadAllSources` so the policy stops being a hardcoded constant. This diff satisfies the new required argument at five call sites by calling a zero-argument module function, `committedSourceFilenamePolicy()` — the name says it reads the *committed* corpora config, not the corpus composed at the root. That converts a dependency-injection seam into a service-locator lookup: the parameter is now formally injectable, but every production call site resolves it from ambient state.

The specific failure this opens is FR-016. `corporaRootFor(environment)` exists so the corpora root can be redirected (tests, an alternate checkout, a non-default deployment). Any invocation that redirects the root will still get the *committed* filename policy at these five sites, because they never see `corporaRoot`. A second corpus whose manifest declares a different source-filename policy will be read with the first corpus's policy, and the failure mode is not a loud error — it is a lookup that resolves to the wrong filename and reports the Source as missing, or resolves to a same-named record in the wrong namespace. Note also that a zero-arg "committed" accessor must pick *one* policy when several corpora are committed; nothing in this chunk shows how that ambiguity is resolved, and if it silently picks the first or merges them, that is a second defect behind the same call. The fix is to carry the policy on `CorpusComposition` and pass it down from the composition root (`summarize.ts` already threads `d.sourcesDir`, so the plumbing shape exists); if a bootstrap accessor must remain, it should take `corporaRoot` as an explicit argument so it cannot be called without one.

---

### AUDIT-20260729-20 — A browser profile's `corpus` field is never checked against the corpus whose file it is — and the test canonizes the mismatch

Finding-ID: AUDIT-20260729-20
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/corpus/browser-profile.test.ts:11-20, 28-34

`loadBrowserProfile(root, corpusId)` resolves `<corpusId>.browser.yml` — that is the production layout (`corpora/port-breton.yml` + `corpora/port-breton.browser.yml`) and the fixture layout (`validate-valid/alpha.yml` + `validate-valid/alpha.browser.yml`). The first test loads `'valid'` and asserts the returned profile is `{ id: 'valid', corpus: 'alpha', … }`. So a profile filed as corpus `valid` declares `corpus: alpha`, and the test asserts that this loads successfully. The contrast is deliberate-looking rather than accidental: the FR-016 test at lines 28-34 loads `'zzz-custom'` and asserts `corpus === 'zzz-custom'`, i.e. the agreeing case is exercised right next to the disagreeing one and neither is rejected.

The rule set recited in `startup-validation.ts:29-30` confirms the gap at the validator level too: profiles must "reference a known corpus and have unique ids" — `alpha` is a known corpus, so a profile filed under `beta` that declares `corpus: alpha` passes both the loader and `validateCorporaConfig`. The fixture list in the sibling chunk carries `validate-profile-unknown-corpus/` and `validate-duplicate-profile-id/` but no mismatch case, which matches that reading. Blast radius: the browser build composes its default sources from the profile loaded for the selected corpus; a mis-filed or copy-pasted `.browser.yml` silently supplies another corpus's `defaultSources`, and the site renders one corpus's browser seeded with a different corpus's sources with no error anywhere. A fix is one line in the loader — reject when `profile.corpus !== requestedCorpusId` — plus a `validate-profile-corpus-mismatch` fixture and a config-validator rule so the failure is caught at `bib validate-config` rather than at render time.

---

### AUDIT-20260729-21 — The contract is left contradicting the implementation, with the resolution recorded only in a source comment

Finding-ID: AUDIT-20260729-21
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/cli/startup-validation.ts:72-79 (the "RECORDED AMBIGUITY" paragraph)

The module comment states, in the present tense, that `contracts/corpus-seam.md` "describes startup validation as 'selected corpus + global identity index', which read literally would pull `readSourceIdentityIndex` (the whole-SSOT read) into every command and contradict FR-010" — and then announces that the code takes the other reading. That is a spec-vs-code divergence resolved in a comment inside one implementation file, while the artifact an unattended consumer actually reads is left saying the opposite.

This is the highest-blast-radius shape in the rubric: the next agent that builds against `contracts/corpus-seam.md` — a wiring change, a second bin, a re-implementation — reaches the literal reading first, because that is what the contract says and nothing in the contract points at this comment. It will wire `readSourceIdentityIndex` into the composition root, which the comment itself says breaks FR-010 and reintroduces an O(number of Sources) YAML parse on every invocation, including on commands that load no Source at all. The comment's own reasoning is sound; the problem is purely where it lives. The fix is to amend `contracts/corpus-seam.md` so the startup scope reads "selected corpus config only; the identity index runs in the full sweep", and leave the code comment as a pointer to the contract rather than as the sole record. (Commit `795f778` claims a startup-vs-full reconciliation in docs; if that commit already amended the contract, then the surviving finding is that this comment now misdescribes the contract in the present tense and should be updated — either way the two artifacts do not agree as written.)

---

### AUDIT-20260729-22 — Translate/summarize discard the selected corpus filename policy

Finding-ID: AUDIT-20260729-22
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/translate-dispatch.ts:38-40; src/cli/translate.ts:146-150,274-283; src/cli/summarize.ts:155-158,324-327

`runTranslateCli` composes a corpus and passes it to the handler, but both handlers ignore the `corpus` argument at dispatch (`translate: (args) => runTranslate(args)`, `translate-source: (args) => runTranslateSource(args)`). The downstream translate code then resolves source records through `committedSourceFilenamePolicy()` and `process.cwd()/bibliography/sources`, not through the selected corpus composition. The same pattern is introduced in summarize: `ensureMemberLayoutRegistered(..., committedSourceFilenamePolicy())`.

This breaks the feature’s corpus-selection contract in a way an operator can hit: selecting a fixture or second corpus validates that corpus, but the command’s source lookup still uses the committed production-wide filename union. That can allow a selected corpus to operate on another corpus’s source IDs, and it undermines FR-016-style injected `corporaRoot` tests because the selected root is composed and then thrown away. The blast radius is high because corpus-dependent commands can perform archive/translation/summarization work against the wrong corpus surface while appearing to honor `--corpus`.

A reasonable fix is to thread `corpus.sourceFilenames` from the composition root into these handlers and then into `runTranslate`, `runTranslateSource`, `runSummarize`, and `runSummarizeSource` or their deps, rather than calling the committed bootstrap from a command path that already has a selected composition.

### AUDIT-20260729-23 — The characterization gate is enumerated, not exhaustive — the T024 regression class can recur for any id not in the hardcoded list

Finding-ID: AUDIT-20260729-23
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/archive/location-legacy-characterization.test.ts:118-152 (LEGACY_SOURCE_IDS / GROUP_CONTAINER_SOURCE_IDS / the "covers exactly" test)

The gate iterates `FIXTURE.sources` and asserts each listed id matches its captured outcome, and the completeness test (`'the fixture covers exactly the 9 legacy source ids plus the 3 group-container ids, no more, no fewer'`) only checks that the *fixture* matches the *hardcoded constant in the same file*. That is a tautology with respect to the system under test: nothing anywhere asserts that the set of source ids for which `isSourceLayoutRegistered` returns `true` is exactly those 9. The gate can therefore only detect drift for ids someone remembered to enumerate.

The file's own header documents that this is not hypothetical: "None of the 9 legacy ids above is a container, which is exactly how a regression slipped past this gate -- `deriveArchiveLayoutPolicy` briefly precomputed a generic layout for every in-scope Source with no filter on `Source.kind`" (lines 47-56). The remediation was to hand-add three more ids (line 134) rather than to close the enumeration hole, so the identical failure mode survives for every id outside the list. Concretely, `tests/unit/archive/member-layout.test.ts:11-14` shows Port Breton declares a second namespace, `PB-S###`, and **not one `PB-S` id appears in this fixture** — the entire PB-S axis of `deriveSourceLayout` is unpinned by the thing described as "the ONLY thing proving that refactor is byte-identical". Any future source-group container added to the corpus is likewise unguarded from day one.

Blast radius: a downstream consumer (or an unattended agent) reads "SC-001 byte-identical characterization gate, green" and merges a layout refactor that silently relocated archive paths for unlisted sources — the exact class of defect that puts bytes in the archive at a path the SSOT record does not describe (Principle XV). Fix: derive the expected registry from the corpus rather than from a literal — enumerate every Source via the composed corpus, assert `isSourceLayoutRegistered` matches an expected predicate for *all* of them (registered iff `kind !== 'source-group'`), and keep the 12-entry byte-identity fixture as the value-level pin on top of that completeness assertion.
```

```

### AUDIT-20260729-24 — `CORPUS_SOURCES` is accepted verbatim for *any* selected corpus — a stale env var silently builds one corpus's site from another corpus's source ids

Finding-ID: AUDIT-20260729-24
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/browser/config.ts:190-197 (`resolveBrowserSources`, the `envOverride` → `deriveBrowserProfile` handoff)

`resolveBrowserSources` parses `CORPUS_SOURCES` into `envOverride` and hands it to `deriveBrowserProfile(selected, envOverride)`, where per this module's own doc it "wins outright over the corpus's committed `defaultSources`". Nothing in this chunk constrains the override's *contents* against `selected` — the ids are never checked against the selected corpus's declared source-id policies (the `{prefix, padWidth}` shapes that FR-002b/FR-018/FR-019 exist to make explicit, and that `buildSourceFilenamePolicy` consumes two files over in `bib-acquire-internet-archive.test.ts:17-20`). The precedence rule ("wins outright") is about beating `defaultSources`; it is not a validation rule.

The failure this opens: Netlify/CI environments inherit variables across contexts and branches. Set `COLONY_CORPUS=kelp-cove` on a branch deploy while a `CORPUS_SOURCES=PB-P001,PB-P002,…` left over from the Port Breton configuration is still exported, and the build proceeds without complaint. Because `bib-coverage.ts:57-64` shows the sources directory is a single shared `<repoRoot>/bibliography/…` tree (not per-corpus), those Port Breton ids will very likely *resolve*, and the kelp-cove site publishes Port Breton material with no error anywhere. That is precisely the corpus bleed this feature was built to make impossible, reintroduced through the one channel that bypasses every new validator (`bib validate-config`, the source-id grammar, the manifest loader). This is the channel-enumeration gap: the override is a value channel with no fixture covering a wrong-corpus value.

Verification is one read: if `deriveBrowserProfile` in `@/corpus/policies` already rejects override ids that don't match `selected.manifest`'s source-id policies, this finding collapses to informational — the doc comment should then say so, since "wins outright" reads as "unchecked". If it does not, the fix is to validate `envOverride` against the selected corpus's policies inside `resolveBrowserSources` and throw naming both the corpus and the offending ids, plus a fixture for `COLONY_CORPUS=<corpus-A>` + `CORPUS_SOURCES=<corpus-B ids>`.

---

### AUDIT-20260729-25 — `CORPUS_SOURCES` alone no longer produces a build — yet the docblocks claim "unchanged operator-visible behavior" twice

Finding-ID: AUDIT-20260729-25
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/browser/config.ts:190-197 and the docblocks at :66-73 and :170-175

In `resolveBrowserSources` the statement order is: compute `envOverride` from `CORPUS_SOURCES`, **then** `const selected = selectCorpus({ corporaRoot, envCorpus: env.COLONY_CORPUS })`, then derive. `selectCorpus` throws on an unset `COLONY_CORPUS` — stated by this same diff at `selectBrowserCorpus`'s `@throws` ("Error if `COLONY_CORPUS` is unset") and at `resolveConfig`'s new `@throws`. So `selectCorpus` runs and can throw even when `envOverride` fully determines the return value and the selected corpus is never consulted for anything.

Before this diff, `CORPUS_SOURCES=PB-P001,PB-P002 npm run site:build` worked standalone (the `sourcesRaw ? split : <hardcoded list>` at the old lines 51-99). After it, the same invocation fails with a corpus-selection error even though the operator explicitly supplied the sources — a confusing diagnostic that names a variable the operator deliberately did not need. And both docblocks assert the opposite: `:71` "in which case it wins outright (FR-005, **unchanged operator-visible behavior**)" and `:174-175` "…when supplied (FR-005, **unchanged operator-visible behavior**)". The behavior is not unchanged; `CORPUS_SOURCES` gained a hard co-requisite. Blast radius: an unattended agent or an operator reading either docblock will build/keep a CI job that sets only `CORPUS_SOURCES` and get a red build whose message points at the wrong variable — and the docblock actively tells them that configuration is supported.

Relatedly, `resolveConfig`'s new `@throws` line is a half-edited sentence — "`@throws Error if no corpus is selected (neither `COLONY_CORPUS` is set)`" — "neither X" with no second alternative, evidently left over from a `--corpus`-or-`COLONY_CORPUS` phrasing that doesn't apply here. Fix either way: short-circuit (`if (envOverride !== undefined) return envOverride;` before `selectCorpus`) and keep the "unchanged" claim true, **or** keep selection unconditional and rewrite both parentheticals to state plainly that `COLONY_CORPUS` is now required in all cases including the override case. Silence on which of the two was intended is the defect.

---

### AUDIT-20260729-26 — Cased source-group MEMBERS are precomputed into `derived`, giving the same object class two different layout-resolution paths depending on an optional field

Finding-ID: AUDIT-20260729-26
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `src/corpus/policies.ts:203-211` (the `derived` loop) + `src/corpus/policies.test.ts:148-166` (the T024 test that locks the behavior in)

The T024 fix excluded source-group **containers** from `derived`, but left source-group **members** in — conditionally. The loop skips a Source only when `source.case === undefined || !caseIds.has(source.case)` or `source.kind === 'source-group'`. So a member with `partOf: 'PB-P004'` and **no** `case` is excluded (and, per the doc at the `SCOPING:` paragraph, "resolves instead via the runtime overlay (`registerSourceLayout`…)"), while a member with the *same* `partOf` that happens to carry `case: 'port-breton'` **is** precomputed with the generic top-level `deriveSourceLayout` result. The test makes this explicit and permanent: `expect(policy.derived.has('PB-P901')).toBe(true)` for a source whose only difference from the excluded `PB-P900` is the presence of `case`. Group membership is a structural property (`partOf`); `case` is not the thing that decides whether a member has its own top-level archive location, so keying the branch on `case` splits one object class across two resolution mechanisms on an incidental field.

Both possible precedence orders are bad. If `derived` is consulted before the runtime overlay — which is what this file's own `ArchiveLayoutPolicy` doc states ("1. `overrides` … 2. `derived` … precede the runtime overlay and the final throw") — then a cased member's precomputed *top-level* layout wins over the nested layout `@/archive/member-layout`'s `ensureMemberLayoutRegistered` registers for it, and fetched bytes land in the wrong directory while nothing fails. If the overlay wins instead, the precomputed entry is not merely dead weight: it silences `sourceLayout`'s terminal throw (FR-017 step 4, "no default") for any cased member that the overlay never registered — which is precisely the failure mode the T024 commit message and the doc comment at the `ALSO EXCLUDED` paragraph identify as the reason containers had to be dropped. Blast radius: silent mis-filing or silent phantom directories for every group member in the shipped Port Breton SSOT that carries an explicit `case`, with no error surfaced to the operator.

A reasonable fix is to skip any Source with `partOf !== undefined` (members resolve via the overlay, uniformly, regardless of `case`), and add a fixture asserting that a cased member is excluded — the mirror of the existing `PB-P900` case. If cased members genuinely *should* be precomputed, the file needs to say why the same class resolves two ways and the precedence relative to `registerSourceLayout` must be stated once, unambiguously.

---

### AUDIT-20260729-27 — Ambient `committedSourceFilenamePolicy()` re-closes the seam T023 just opened — production paths resolve the corpora root implicitly while `sourcesDir` stays injected

Finding-ID: AUDIT-20260729-27 (claude-01 + claude-02 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/sourcegroup/acquire.ts:324-331, src/sourcegroup/acquire-complete.ts:1-60

`runAcquire` and `completeAndVerify` both take `sourcesDir` as an injected parameter, but obtain the *other* half of the enumeration contract — the `SourceFilenamePolicy` — from a zero-argument ambient call: `loadAllSources(input.sourcesDir, committedSourceFilenamePolicy())`. The two inputs therefore resolve from different roots: `sourcesDir` from the caller (a fixture tmpdir in tests, a repo path in production), and the filename policy from whatever the process considers "the committed corpora root." That is exactly the coupling shape the T012–T014/T023 refactors were built to remove, reintroduced under a new name. `src/corpus/validate.ts:24-33` states the rule this violates in its own words: "`corporaRoot`, `sourcesDir` and `installedCapabilities` are all parameters, never literals or defaults here… Hardcoding either would make SC-003 (a second corpus addable as fixtures only, zero core `src/` edits) unsatisfiable." A fixture corpus cannot drive `runAcquire` at all — `acquire` will enumerate the fixture `sourcesDir` using *production* Port Breton prefixes, so a second-corpus source id that Port Breton's policy does not match is invisible and the call dies with `acquire: unknown sourceId`, a message that names the wrong cause.

The in-diff justification does not hold: the comment at `acquire.ts:327-329` says "This chain carries no corpus parameter (its input record is the CLI's, not the composition root's)". `AcquireInput` already carries `sourcesDir`; adding a `filenamePolicy: SourceFilenamePolicy` field beside it is the same one-line change the tests already model by passing `PB_FILENAMES` explicitly. "The chain has no parameter" is a description of the current struct, not a constraint on it. Per the project's no-fallbacks rule, a defaulted union over all committed manifests is precisely a bug-factory default: it makes the wrong-root case succeed quietly (production prefixes happen to match) instead of failing loud.

Blast radius: an adopter or agent adding a second corpus as fixtures (SC-003's headline claim) gets a green `validate-config` and a green T017 second-corpus test, then hits `unknown sourceId` on the first `acquire` and has no signal pointing at the corpora root. Fix: thread `filenamePolicy` through `AcquireInput` (and the completion chain) from the CLI composition root that already selects the corpus, and delete the ambient bootstrap from these two call sites. Note also that `src/corpus/source-filename-bootstrap.ts` — the module this finding turns on — is **not present in this diff chunk**; its failure behavior when the corpora root is absent/unreadable, and whether it caches or re-reads per call, could not be audited here and should be.

---

### AUDIT-20260729-28 — FR-016 proof tests reference a fixture root (`tests/fixtures/corpora/an-arbitrary-place/`) that does not appear anywhere in the change

Finding-ID: AUDIT-20260729-28
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/corpus/manifest.test.ts:10, :37-42, :208-211 (fixture `tests/fixtures/corpora/an-arbitrary-place/zzz-custom.yml`)

`ARBITRARY_ROOT` is defined at `manifest.test.ts:10` as `join(FIXTURES_ROOT, 'an-arbitrary-place')` and is the sole evidence for the two tests that claim to *prove* FR-016 (injected `corporaRoot`, no hardcoded convention): `loadCorpusManifest(ARBITRARY_ROOT, 'zzz-custom')` at :38 and `listCorpusManifests(ARBITRARY_ROOT)` at :209. Every other fixture this test file consumes is present in the cross-chunk file manifests supplied to this audit — `tests/fixtures/corpora/empty-root/.gitkeep`, `list-cases/alpha.yml`, `list-cases/alpha.browser.yml`, `list-cases/beta.yml`, and the full `manifest-cases/*.yml` set. `tests/fixtures/corpora/an-arbitrary-place/zzz-custom.yml` is absent, and it would sort *before* `empty-root/` in the alphabetical listing where it is conspicuously missing, so this is not an artifact of the trailing truncation.

If the fixture is genuinely absent, both FR-016 tests fail hard and loudly: `loadCorpusManifest` throws `cannot read file: ENOENT`, and `listCorpusManifests` throws `directory does not exist` from `manifest.ts:310`. Blast radius: the suite is red on a branch whose final commit is `chore(corpus-config-seam): mark all 24 tasks complete (ledger-backed)`. Worse than red, though, is the governance consequence — the ledger records FR-016 (and by extension SC-003, "a second corpus addable as fixtures only") as proven by a test that cannot execute. A downstream agent reading the ledger will treat the injected-root seam as verified when nothing verified it.

Verification is one command: `ls tests/fixtures/corpora/an-arbitrary-place/`. If the file exists and was simply dropped from the chunk manifest, this finding is void. If it does not, the fix is to commit `zzz-custom.yml` with `sourceIds: [{prefix: ZZ, padWidth: 5, allocatable: true}]` matching the assertion at :41 — and, separately, to ask why a red suite reached the completion commit.

---

### AUDIT-20260729-29 — Manifest IDs Can Escape The Corpora Root

Finding-ID: AUDIT-20260729-29
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/corpus/manifest.ts:246-288

`loadCorpusManifest(corporaRoot, id)` builds the path with `join(corporaRoot, `${id}.yml`)` before validating `id`, and the manifest validator only checks that the parsed `id` is non-empty and equals the supplied `expectedId`. That means an id like `../outside` is accepted if `../outside.yml` exists and declares `id: ../outside`; the loader reads outside the injected corpora root and returns it as a valid `CorpusManifest`.

This violates the config seam’s boundary: manifests are supposed to be committed under `<corporaRoot>/<id>.yml`, and FR-008/data-model validation includes corpus-id validity. The blast radius is high because `selectCorpus` passes CLI/env corpus IDs directly into this loader, so a downstream caller can select a corpus outside the configured corpus directory and still receive narrow policies derived from it. A fix is to validate the requested and declared corpus id against the intended corpus-id grammar before path construction or to resolve the path and assert it remains inside `corporaRoot`; tests should cover slash/path traversal IDs and malformed committed manifest basenames.

### AUDIT-20260729-30 — Slug truncation can drop the distinguishing tail of two long titles, silently filing two Sources into one archive directory

Finding-ID: AUDIT-20260729-30
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/archive/derive-layout.ts:55-88 (`slugify` / `deriveSlug`), with src/archive/layout-bootstrap.ts:110-140 (the `derived` map)

`deriveSourceLayout` builds `{case, type, slug, kind}` and the archive path for a source is that tuple. The only per-source discriminator is `slug`, and `slug` is derived from free-text title, then **capped to 80 characters at a word boundary** (`derive-layout.ts:66-71`: `const capped = slug.slice(0, MAX_DERIVED_SLUG_LENGTH); const lastHyphen = capped.lastIndexOf('-'); ...`). Long periodical/monograph titles routinely differ only in their tail — a volume, a year, a part number, a place qualifier. Two sources in the same case whose titles agree for the first 80 characters derive the **identical** `{case, type, slug, kind}` and therefore the identical archive directory. Their fetched pages (`f001.yml..fNNN.yml` for the flat/monograph shape) then interleave in one directory with no error at any layer.

Nothing anywhere checks the reverse direction. `composeArchiveLayoutPolicy` builds `derived` as a `Map<sourceId, SourceLayout>` and detects only *sourceId* collisions across manifests (`layout-bootstrap.ts:130-141`) — two distinct sourceIds mapping to one layout is not a collision it can see. `layoutsEqual` exists (`derive-layout.ts:42-44`) but is used for characterization comparisons, not for uniqueness. The same hole exists without truncation for two sources that genuinely share a title (a reprint, an edition), but truncation makes it reachable with *distinct* titles, which is the surprising case.

Blast radius: silent commingling of assets from two Source IDs in one archive folder — exactly the "an object you cannot find through the record is not acquired, it is lost" failure the project's Principle XV is written against. It is silent (no throw, no warning), it corrupts durable state rather than a transient run, and recovery requires re-deriving which folio belonged to which source after the fact. A reasonable fix: have `composeArchiveLayoutPolicy` (or `deriveArchiveLayoutPolicy`) reject a policy in which two sourceIds produce structurally-equal layouts, naming both claimants and pointing at `archiveLayoutOverrides` as the resolution — the same fail-loud shape already used for the sourceId collision immediately above it. A disambiguating suffix chosen silently would be worse; the manifest override is the authored escape hatch and should be forced.

### AUDIT-20260729-31 — `realResolve` collapses `..` lexically before consulting the filesystem, so a `../` escape through a symlink passes the non-overridable guard

Finding-ID: AUDIT-20260729-31
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/archive/archive-root.ts:67-86 (`realResolve`), consumed by `assertInsideArchive` at :97-111

`realResolve` starts with `let current = path.resolve(target)` (`archive-root.ts:68`). `path.resolve` is a **purely lexical** normalizer: it collapses `..` segments with no knowledge of symlinks. Only after that collapse does the function call `realpathSync`. The docblock on `assertInsideArchive` claims the guard works "by resolving both operands to their real absolute forms (collapsing `..` and following symlinks)" — but performing those two operations in that order is unsound, and the case it advertises protection against (`Guards against '../' escapes`) is precisely the case it can miss.

Concrete failure: archive root `/archive`, and a symlink `/archive/link -> /etc` exists inside the archive (a mirror, a convenience link, an operator's shortcut — the guard is supposed to be non-overridable precisely because it does not trust the tree's shape). A caller passes `absPath = /archive/link/../evil`. `path.resolve` collapses it to `/archive/evil` **before** any `realpathSync`, so the symlink is never traversed by the guard; `/archive/evil` does not exist, `realResolve` walks up to `/archive`, re-appends `evil`, and returns `/archive/evil`. `rel` is `evil`, so `inside` is true and the guard passes. The subsequent `fs` write uses the caller's original string, where the kernel *does* traverse the symlink, and the bytes land in `/etc/evil`. Note the guard behaves correctly for `/archive/link/evil` (no `..`) — the defect is specific to the lexical collapse.

Blast radius: this is the single, deliberately non-bypassable write guard for the archive (FR-006), and the finding is a write outside the archive root that the guard reports as safe. A fix: resolve the *deepest existing ancestor of the un-collapsed path* — walk the segments of `target` from the root, `realpathSync` each existing prefix and re-resolve after each hop, so a symlink encountered before a `..` is followed before the `..` is applied — or reject any `absPath` containing a `..` segment outright before normalizing, which is cheap and matches the "no bypass, by design" posture.

### AUDIT-20260729-32 — Retiring `SOURCE_LAYOUTS` makes a missing `archiveLayoutOverrides` entry degrade into a silently-derived wrong archive path instead of a throw

Finding-ID: AUDIT-20260729-32
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/archive/location.ts:1-38 (new header + re-export barrel); pre-image src/archive/location.ts:30-100 (deleted `SOURCE_LAYOUTS`)

The deleted static map was the *only* place where a hand-verified, non-derivable slug was pinned. Read the pre-image entries the diff removes: `PB-P002` → `nouvelle-france-colonie-libre-port-breton` and `PB-P003` → `baudouin-aventure-port-breton-1883`. Neither is reproducible by the `slugify`/`deriveSlug` path also shown in the pre-image (`.normalize('NFD') … replace(/[^a-z0-9]+/g,'-')`, 80-char word-boundary cap): a canonical title of the form "La Nouvelle-France, colonie libre de Port-Breton" slugifies to `la-nouvelle-france-colonie-libre-de-port-breton`, and `baudouin-aventure-port-breton-1883` is plainly an operator-authored short slug, not a title slugification. By contrast the *derived-looking* entries (`PB-P055` with its `œ`-dropped `-uvre-`, `PB-P056`, `PB-P057`) are byte-consistent with `slugify`, which is exactly the tell that the map held two populations: derivable and non-derivable.

The new resolution order stated in the header (line 27-31) is `manifest archiveLayoutOverrides → runtime overlay → precomputed generic derivation → throw`. The terminal `throw` only fires when the source is unknown entirely. For a *known* source whose override entry is missing or misspelled, resolution does not throw — it falls through to the generic derivation and returns a **plausible but wrong** slug. On the read paths (`monographDir`, `findIssueDir`, `resolveFetchedDir`, lines 77-185) the `existsSync` guards convert that into a "not fetched yet" error, which is confusing but survivable. On the **write** path (`issueDir`, line 42-77, and everything the fetcher drives through it) there is no existence guard: masters get written into a newly-created parallel directory under a divergent slug. That is precisely the orphan-asset class this project's Principle XV names as a defect — bytes land in the archive tree that the SSOT record does not point at, and nothing fails.

Blast radius: this is the normal path for the feature's own stated goal. Onboarding a second corpus (T016/T017) or a new source into Port Breton means authoring override entries by hand; omitting one is a one-line mistake with no error and no test that would catch it, because the derived slug is well-formed. A reasonable fix is a bootstrap-time invariant in `@/archive/layout-bootstrap`: for any source the corpus declares as *legacy-placed* (or simply: any source whose on-disk directory already exists under a slug ≠ its derived slug), require an explicit override and throw at `installArchiveLayoutPolicy` time if absent — so the failure is a loud startup error at composition, not a quiet mkdir at fetch time. `location.ts` itself is only the barrel here; the guard belongs where the policy is composed.

---

### AUDIT-20260729-33 — `installArchiveLayoutPolicy` swaps the policy but never clears the runtime overlay, so stale layouts outrank the newly-installed corpus

Finding-ID: AUDIT-20260729-33
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=reachable, fix-debt=no; reachable, high blast radius — NOT calibrated down (real signal preserved, SC-003).
Surface:    src/archive/layout-resolve.ts:42-45, :66, :87 (module-level `runtimeLayoutOverlay`)

`installArchiveLayoutPolicy` is documented as the seam's injection point — "a test (or an alternative composition root) points the layout resolution at a fixture corpus with zero core edits (SC-003)" — and it correctly discards the memoized composition (`composedPolicy = null;`, line 44). It does **not** touch `runtimeLayoutOverlay`, which is a module-level `Map` (line 66) with no clear, reset, or delete path anywhere in the module. The overlay is step 2 of the resolution order, i.e. it *outranks* `policy.derived` (step 3). So after `installArchiveLayoutPolicy(policyForCorpusB)`, any sourceId registered while corpus A was in force still wins over corpus B's own generic derivation, silently, with no error. The only guard that exists — the conflicting-re-registration throw at lines 81-86 — does not fire, because nobody re-registers; resolution just quietly reads the stale entry.

Blast radius: `sourceLayout` is the single resolver behind `issueDir`, `monographDir`, `sourceRootDir`, `findIssueDir`, `resolveFetchedDir` and the provenance layer (per the doc comment at lines 168-172). A stale overlay entry therefore causes reads and **writes** to land under the wrong `archive/cases/<case>/<type>/<slug>` — mis-filed durable assets whose SSOT record points elsewhere, which is exactly the orphan-asset class the project constitution (Principle XV) treats as a defect. The two concrete places this is reachable today are (a) `tests/integration/corpus/second-corpus.test.ts`, which by its name installs a second corpus's policy in a process that may already have resolved or registered sources, and (b) `src/archive/location.test.ts`, whose overlay test at :122-135 deliberately registers a **conflicting** layout for `PB-P002` and then never removes it — that poisoned entry survives for the remainder of the module instance, and is masked only by the fact that `PB-P002` happens to also carry a manifest override (step 1).

A reasonable fix: give the module a single `resetArchiveLayoutResolution()` (clearing `installedPolicy`, `composedPolicy`, **and** `runtimeLayoutOverlay`) and have `installArchiveLayoutPolicy` clear the overlay as part of the swap — the overlay is per-corpus-run state, not process-global state, so it must have the same lifetime as the policy it overlays. Add a regression test that installs policy A, registers an overlay entry, installs policy B, and asserts the sourceId now resolves from B's derivation (or throws) rather than from A's leftover overlay.

---

### AUDIT-20260729-34 — The one seam with a module-global fallback is the one seam never proven through the shipped composition path

Finding-ID: AUDIT-20260729-34
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=reachable, fix-debt=no; reachable, high blast radius — NOT calibrated down (real signal preserved, SC-003).
Surface:    `tests/integration/corpus/second-corpus.test.ts` — header ≈L48–60, `installFrom` ≈L262–270, seam 5 bodies ≈L272–345

Every other seam in this suite is deliberately exercised through the *shipped* path: seam 1 builds `corpus` via `composeCorpus({ corporaRoot, cliCorpus })` and the comment states it is "built exactly as `@/cli/dispatch`'s `runCli` builds it"; seam 2 threads `corpus.scope.validCaseIds`; seam 4 threads `corpus.sourceFilenames`; seam 6 calls `resolveBrowserSources` with injected env. Seam 5 breaks that pattern — it calls `installArchiveLayoutPolicy(composeArchiveLayoutPolicy({...}))` by hand inside the test, and **no assertion anywhere in this file ties that install to `runCli` / the CLI composition root.** The file's own header states the consequence of not installing: "the deferred composition it falls back to resolves the **PRODUCTION** corpora root."

That combination is exactly the failure mode the negative controls in seam 4 were written to prevent, one layer up. If the shipped dispatcher does *not* perform the install on every path that can reach `sourceLayout` (the header notes it is "reached deep inside the fetcher via `resolveFetchedDir`" — i.e. reachable from acquire/fetch code, not just from the CLI entry that composed the corpus), then a real second corpus resolves **Port Breton's** layouts silently, with no error, while SC-003 stays green because the *test* did the install the product doesn't. Blast radius: an operator standing up corpus #2 writes acquired masters into `archive/cases/port-breton/...` — wrong-corpus asset placement, which per Principle XV is an orphan/misfiled asset, and the fallback is precisely the "fallback that hides a failure mode" the project's CLAUDE.md forbids.

A reasonable fix is one added assertion in seam 5 that drives the *dispatcher's* composition (the same function `runCli` calls to install, not a hand-rolled `installFrom`) and then checks `sourceLayout('SYN0001').case === 'kelp-cove'`; plus a test asserting that `sourceLayout` **throws** rather than falling back when no policy has been installed. If the dispatcher genuinely does not install, that is the finding proper and the test cannot substitute for it.

---
