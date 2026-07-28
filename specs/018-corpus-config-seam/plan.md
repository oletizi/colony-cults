# Implementation Plan: Corpus Config Seam

**Branch**: `main` (long-lived; dir resolved via `.specify/feature.json`) | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/018-corpus-config-seam/spec.md`; design `docs/superpowers/specs/2026-07-27-corpus-config-seam-design.md` (review-revised).

## Summary

A **composition-time configuration seam** that lets one shared core run varied research corpora. Corpus identity/policy becomes a validated **data manifest** (`corpora/<id>.yml`); it is selected explicitly (`--corpus` → `COLONY_CORPUS` → fail loud), resolved once at the application composition root, and injected downward as **narrow per-seam policies** (validCaseIds set; `SourceIdPolicy`; archive-layout policy; a separate `BrowserProfile`). The four localized single-corpus constants are removed from core modules and read from those policies. Port Breton is authored as corpus-instance #1, a **behavior-preserving** extraction (byte-identical paths, unchanged IDs/coverage, no data migration), and the seam is **proven by a synthetic second corpus** added as manifest+fixture only. Domain generalization (pluggable discovery + date normalizer) is explicitly deferred to epic spec 2.

## Technical Context

**Language/Version**: TypeScript via `tsx` (per constitution); no `ts-node`.

**Primary work**: a small, disciplined refactor + new config layer — no rewrite. Touches four hotspots (`archive/location.ts`, `bibliography/scope.ts`, `sourcegroup/id-alloc.ts`, `browser/config.ts`) + a new `corpus/` module (manifest type, typed loader, validator, composition-root selection) + narrow policy interfaces.

**Storage**: `<corporaRoot>/<id>.yml` manifests + `<corporaRoot>/<id>.browser.yml` profiles (git-tracked data; production root `corpora/`, injected per FR-016); existing bibliography SSOT + `cases/<case>/…` archive layout unchanged.

**Testing**: `vitest` — **characterization tests** capturing current `location.ts` outputs for the 9 legacy sources (byte-identical gate), validator unit tests, a selection-precedence test, and a **synthetic-second-corpus integration test** that proves core modules are untouched. `@/` imports, no `any`, files ≤ 300–500.

**Target Platform / Project Type**: local CLI (`tsx`) + the static browser build; single repository, `cases/<case>/` grain (no restructure).

**Performance / Scale**: negligible — config loads once at startup; validation is O(manifests).

**Constraints**: behavior-preserving for Port Breton (data unchanged); fail loud, no implicit default (V); composition/DI, narrow interfaces, no service locator (VI); type-safe (VII); faithful reuse of the shipped registries (VIII); no spec-2 fields.

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1. No violations — no Complexity Tracking.*

- **I. Evidence Before Narrative** — N/A (infrastructure refactor; no research claims).
- **II. Preserve Disagreement & Uncertainty** — N/A.
- **III. Provenance Is Mandatory** — PASS (no change to provenance; paths byte-identical).
- **IV. Respect Copyright** — N/A (rights logic untouched; already generic).
- **V. Fail Loud, No Fallbacks** — PASS. No selected/unknown/invalid corpus → loud failure at the load boundary; no implicit Port-Breton fallback.
- **VI. Composition Over Inheritance** — PASS. Narrow per-seam policy interfaces derived at the composition root and injected; the corpus is **not** a service locator; registries stay orthogonal.
- **VII. Type Safety** — PASS. `@/`, no `any`/`as`/`@ts-ignore`, files ≤ 300–500; typed manifest loader with a discriminated `schemaVersion`.
- **VIII. Faithful Tool Adoption** — PASS. Reuses the shipped repository/source-query registries + coverage/validate through their interfaces; never `bib migrate`; spec authored through the stack-control front door.
- **IX. Durable Work** — PASS. Committed + pushed per coherent unit.
- **X. No Git Hooks** — PASS.
- **XI. Design Through the Design Skill** — N/A. No UX/UI (the `BrowserProfile` is config, not a UI change); if the browser's *rendering* ever changes it routes through `/frontend-design`.
- **XII. Respect the Source (Frugal, Polite Access)** — N/A. This feature makes no external source request; it touches only local config, layout derivation, and CLI wiring.
- **XIII. No Agent Memory, Ever** — PASS. All durable knowledge for this feature lives in the repository (this spec dir, the design record, `corpora/README.md` per T021); no agent-memory store is read or written.
- **XIV. The Operator Owns Scope** — PASS. Full scope is captured (spec Input: "Full scope, no YAGNI"); no agent-originated cut. The spec-2 deferral (`discoveryMechanism` / `dateNormalizer`, FR-012) is the **operator's recorded epic decision**, not an agent trim. Findings that suggest additional work are surfaced, never silently dropped.
- **XV. Metadata Integrity (No Orphan Assets)** — N/A. Nothing here retrieves an object or writes an asset to the archive/object store. Archive *paths* are re-derived rather than re-written, under a byte-identical characterization gate (SC-001) with no canonical data migration, so no SSOT record can fall out of sync.

## Project Structure

### Documentation (this feature)

```text
specs/018-corpus-config-seam/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/   # manifest schema, selection, narrow policies, validator
└── tasks.md     # /speckit-tasks
```

### Source Code (repository root)

```text
corpora/
└── port-breton.yml          # NEW — instance #1 (authored from current constants)
                             #   NOTE: `corpora/` holds ONLY committed, production manifests —
                             #   every one MUST validate before any corpus runs (FR-015).

tests/fixtures/
├── corpora/synthetic.yml            # NEW — test-only synthetic second corpus (proof of seam)
├── corpora/synthetic.browser.yml    # NEW — its browser profile, SAME convention as production
└── cases/<second-case>/…            # NEW — its case fixtures
                                     #   corporaRoot is injected here under test (FR-016)

src/
├── corpus/                  # NEW — the seam
│   ├── manifest.ts          #   CorpusManifest type + typed loader (schemaVersion)
│   ├── validate.ts          #   config validator + repo-wide collision rules
│   ├── select.ts            #   --corpus → COLONY_CORPUS → fail loud (composition root)
│   └── policies.ts          #   derive narrow policies (validCaseIds, SourceIdPolicy, layout, browser)
├── archive/location.ts      # EDIT — retire SOURCE_LAYOUTS map → generic + validated overrides
├── bibliography/scope.ts    # EDIT — PORT_BRETON_CASE_ID → injected validCaseIds
├── sourcegroup/id-alloc.ts  # EDIT — module constants → injected SourceIdPolicy
├── browser/config.ts        # EDIT — default list → injected BrowserProfile
└── cli/                     # EDIT — thread --corpus + `bib validate-config`; wire composition root
```

**Structure Decision**: a new `corpus/` module owns the manifest/loader/validator/selection and derives narrow policies; the four hotspots are edited to consume injected policies (not the manifest). The composition root (CLI + browser build entrypoints) selects the corpus once and injects. No module receives an omnibus corpus object.

## Corpus-dependent command table (FR-014)

Traced from the real registration, not from docs/naming: `src/index.ts` → `src/cli/dispatch.ts` (`HELP_TEXT`/`--version`, the flat `HANDLERS` map for `census`/`fetch-issue`/`fetch-source`/`ocr`/`restore-images`/`summarize`/`summarize-source`, and the `bib <subaction>` fan-out into `src/cli/bibliography.ts`'s `SUBACTIONS`); and the separate `translate` bin (`src/translate-index.ts` → `src/cli/translate.ts`). Classification applies the spec's "Command scope" definition verbatim: **corpus-dependent** = reads/mutates canonical corpus data, allocates IDs, resolves scope, computes archive paths, produces coverage, or loads corpus-specific browser defaults; **exception** = none of those (validated per manifest, not per invocation).

`BrowserProfile` column: **none** of the commands below currently require one. The only present-day consumer of browser default sources (`defaultSources` / `CORPUS_SOURCES`) is `src/browser/config.ts`, which backs the Astro site build (`site:build`/`site:preview`, invoked via `npm run`, not `bib`/`translate` dispatch) — not a registered CLI command. `bib query-source`'s Playwright session is a governed-fetch browser (WAF-clearing), unrelated to `BrowserProfile`/`defaultSources`.

### `bib` — flat verbs (`src/cli/dispatch.ts` → `HANDLERS`)

| Command | Class | Reason (FR-014 clause) | Needs `BrowserProfile`? |
|---|---|---|---|
| `census <periodicalArk> --source-id --slug` | corpus-dependent | Mutates corpus data — writes `data/census/<sourceId>-<slug>.json` keyed to a corpus Source id. | No |
| `fetch-issue <issueArk> --source-id` | corpus-dependent | Computes archive paths — `issueDir`/`sourceLayout` under `resolveArchiveRoot` (`src/cli/fetch-issue.ts`). | No |
| `fetch-source <periodicalArk> --source-id` | corpus-dependent | Computes archive paths — `issueDir`/`monographDir`/`sourceLayout` (`src/cli/fetch-source.ts`). | No |
| `ocr <issueArk> --source-id` | corpus-dependent | Computes archive paths — `resolveArchiveRoot`/`resolveFetchedDir`/`ensureMemberLayoutRegistered` (`src/cli/ocr.ts`). | No |
| `restore-images <issueArk> --source-id` | corpus-dependent | Computes archive paths — `resolveArchiveRoot`/`resolveFetchedDir` (`src/cli/restore-images.ts`). | No |
| `summarize <sourceId> [issueArk]` | corpus-dependent | Reads/mutates corpus data + archive paths — `loadSourceFile`/`writeSourceFile`, `resolveArchiveRoot`, `sourceLayout` (`src/cli/summarize.ts`). | No |
| `summarize-source <sourceId>` | corpus-dependent | Same as `summarize` (per-source rollup over the same corpus data + archive paths). | No |

### `bib <subaction>` (`src/cli/bibliography.ts` `SUBACTIONS`, some re-exported from sibling modules)

| Subaction | Class | Reason (FR-014 clause) | Needs `BrowserProfile`? |
|---|---|---|---|
| `migrate` | corpus-dependent | Mutates canonical corpus data — folds legacy representations into the bibliography SSOT. | No |
| `show <sourceId>` | corpus-dependent | Reads canonical corpus data — builds the canonical model from `bibliography/sources`. | No |
| `validate` | corpus-dependent | Reads canonical corpus data — validates the SSOT + search-log for the active corpus (distinct from the future repo-wide `validate-config`). | No |
| `regenerate` | corpus-dependent | Reads corpus data and mutates generated views from it. | No |
| `inventory <locator> --group` | corpus-dependent | Allocates IDs + mutates corpus data — creates a new member Source in the SSOT (`runInventory`/`runMuseumInventory`). | No (Papers Past resolve-only mode opens a Playwright session, but not for `defaultSources`) |
| `verify-member <id>` | corpus-dependent | Reads canonical corpus data — loads SSOT members for verification. | No |
| `promote <id>` | corpus-dependent | Mutates canonical corpus data — promotes a member's SSOT status. | No |
| `exclude-member <id> --reason` | corpus-dependent | Mutates canonical corpus data — writes an excluded status to the SSOT. | No |
| `acquire <id>` | corpus-dependent | Computes archive paths + mutates corpus data — registers/derives the member's archive layout and completes its SSOT record (`registerMemberArchiveLayout`, `resolveArchiveRoot`). | No |
| `reconcile <id>` | corpus-dependent | Computes archive paths + mutates corpus data — folds acquisition truth into the SSOT `repositoryRecords[].status`. | No |
| `discover <query>` | **AMBIGUOUS — flagged** | As implemented today, touches none of the six clauses: no `sourcesDir`/`repoRoot`, no corpus data read/write, no ID allocation, no archive paths, no coverage, no browser defaults — only a stateless BnF SRU catalogue query. Classified **exception** on strict reading, but it sits in the SSOT-verb group in `HELP_TEXT` and `plan.md`'s own "Domain generalization (pluggable discovery…)" deferral to epic spec 2 implies it may become corpus-scoped later. Do not treat this classification as settled without confirming with the spec owner. | No |
| `coverage` | corpus-dependent | Produces coverage — explicit FR-014 clause; builds `CoverageReport` from the SSOT + search-log + scopes registry. | No |
| `rights-assess <sourceId>` | corpus-dependent | Reads corpus data always (review mode); mutates it in write mode (`--status`) — both modes call `selectRecord`/`loadSourceFile` against the SSOT. | No |
| `query-source <source-id> --query` | **AMBIGUOUS — flagged** | As implemented today, touches none of the six clauses: `<source-id>` resolves against `@/sourcequery/source-config`'s static **capability registry** (external repository endpoints like `papers-past`, not a corpus bibliographic Source id), and persisted captures land in a fixed repo-wide `bibliography/repository-responses/` cache, not under any corpus's archive root. Classified **exception** on strict reading (also the spec's own explicit exceptions example — `bib validate-config` — is adjacent in spirit), but it is grouped under "Bibliography / acquisition" in `HELP_TEXT` and its capture directory is corpus-SSOT-adjacent. Flagging rather than silently deciding. | No (Playwright session here is the governed WAF-clearing browser, not `defaultSources`) |

No flag names change any of these commands' corpus-touch — checked `--dry-run` (`acquire`, `inventory`), `--check` (`regenerate`), `--status` presence (`rights-assess`), and `--repository` (`inventory`); every mode of every corpus-dependent command above stays corpus-dependent in all its invocation modes, and neither ambiguous command becomes corpus-dependent under any flag combination.

### Resolution of the two flagged ambiguities (controller decision, T002 review)

Both `discover` and `query-source` are **exceptions for spec 1**, and T009 wires them as such. Rationale: neither triggers any of FR-014's six corpus-dependent clauses — `discover` is a stateless BnF SRU catalogue query, and `query-source` resolves `<source-id>` against the *capability* registry (external repository endpoints), not a corpus bibliographic Source id. Requiring a selected corpus for either would fail commands that legitimately have no corpus in hand.

Two consequences recorded rather than left implicit:
- **`discover` is revisited in epic spec 2.** When discovery becomes pluggable and corpus-scoped (`discoveryMechanism`), its classification flips to corpus-dependent. This is a known, scheduled change, not an oversight.
- **`query-source` captures stay repo-wide.** Persisted captures land in `bibliography/repository-responses/`, which is NOT corpus-scoped. Under multi-corpus, two corpora share that cache. This is coherent — captures are keyed by external source + query, not by corpus — but it means the cache is a shared repository-level resource, not corpus data, which is precisely why the command is an exception.

### `translate` — separate bin (`src/translate-index.ts` → `src/cli/translate.ts`)

`translate`/`translate-source` are recognized by the shared `Command` union (`src/cli/parse.ts`) but are **not** wired in `bib`'s `HANDLERS` (`src/cli/dispatch.ts` explicitly redirects them to this separate bin, exit code 2). They are real commands only under the `translate` executable.

| Command | Class | Reason (FR-014 clause) | Needs `BrowserProfile`? |
|---|---|---|---|
| `translate <issueArk>` | corpus-dependent | Computes archive paths + mutates corpus data — `resolveArchiveRoot`, `ensureMemberLayoutRegistered`, translation provenance writes. | No |
| `translate-source <sourceId>` | corpus-dependent | Same as `translate` (whole-source loop over the same archive paths + SSOT writes). | No |

### Exceptions (generic help/version)

| Command | Class | Reason |
|---|---|---|
| `bib` (no args), `bib --help`/`-h` | exception | Generic help — spec's explicit exception clause. |
| `bib --version`/`-v` | exception | Generic version — spec's explicit exception clause. |
| `translate --help`/`-h` | exception | Generic help (separate bin). |
| `translate --version`/`-v` | exception | Generic version (separate bin). |

### Planned, not yet registered

| Command | Class | Reason |
|---|---|---|
| `bib validate-config` | exception (spec-named) | Named verbatim in spec.md's exceptions list and in FR-008/FR-015, but not yet wired — `src/cli/bibliography.ts`'s `SUBACTIONS` has no `validate-config` entry today. It is a **future task** (T018) that this table's classification governs when it lands; listed here so T009 wires it as an exception from the start rather than retrofitting. |

### Totals

23 commands/subactions are currently registered and reachable (7 flat `bib` verbs + 14 `bib` subactions + 2 `translate` verbs). Of those: **21 corpus-dependent**, **2 flagged ambiguous** (`discover`, `query-source` — classified exception on strict reading of FR-014's six clauses, but not settled). Adding the 4 generic help/version entries (all exceptions) and the 1 planned-but-unregistered `bib validate-config` (exception, spec-named) gives 28 rows total: 21 corpus-dependent, 7 exception (4 help/version + 2 ambiguous-but-exception + 1 planned). No command was found that is corpus-dependent only under certain flags — every multi-mode command (`acquire`, `inventory`, `regenerate`, `rights-assess`) is corpus-dependent (or, for the two ambiguous commands, non-corpus) in every one of its invocation modes.

## Complexity Tracking

No constitution violations — not applicable.
