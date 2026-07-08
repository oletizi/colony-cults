# Implementation Plan: Source Translation

**Branch**: `002-source-translation` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-source-translation/spec.md`. Approved design record: `docs/specs/2026-07-08-source-translation-design.md`.

## Summary

Add a reusable CLI capability that turns the gallica-fetcher's French OCR (`issue.txt`) into a corrected French transcription and a readable English translation, processed **page by page** (the natural chunk), each page idempotent and resumable, with whole-issue artifacts assembled from the pages. The engine is the **Claude Code CLI** (`claude -p`), shelled out behind a dependency-injected command runner — mirroring exactly how the shipped OCR pipeline shells out to `ocrmypdf`. Artifacts and their YAML provenance companions are written into the private archive **alongside the source**, reusing the fetcher's `@/archive/*` modules and its non-overridable write-guard. Rights are read **offline** from the already-stored page provenance (no re-query of Gallica), and a non-public-domain source is refused. First target: *La Nouvelle France* (`PB-P001`).

## Technical Context

**Language/Version**: TypeScript 5.3 on Node 20, executed with `tsx` (ESM, `"type": "module"`).

**Primary Dependencies**: None new at runtime. External tool dependency: the **Claude Code CLI** (`claude`), shelled out (not a library, no API SDK). Reuses in-repo modules: `@/archive/location`, `@/archive/store`, `@/archive/provenance`, `@/archive/checksum`, `@/model/*`, and the `execCommand` runner pattern from `@/ocr/exec`.

**Storage**: Files in the private archive at the fixed sibling path `../colony-cults-archive`, per-source/per-issue tree (`archive/cases/<case>/<type>/<slug>/<date>_<ark>/`). Outputs are text files + `.yml` companions written alongside `issue.txt`.

**Testing**: `vitest` (`vitest run`), unit + integration; the `claude` runner and the clock are dependency-injected so tests never invoke the real CLI. `tsc --noEmit` for typecheck.

**Target Platform**: Local developer / research-agent machine (macOS/Linux) with the Claude Code CLI installed and authenticated.

**Project Type**: Single-package CLI (adds a second bin to the existing `gallica-fetcher` package).

**Performance Goals**: Not latency-bound; correctness and resumability over throughput. Page-level idempotency bounds re-work after any failure to a single page. Whole-source runs pace engine calls to respect subscription rate limits.

**Constraints**: House rules (CLAUDE.md / AGENTS.md): `@/` imports only; no `any` / `as` / `@ts-ignore`; composition + constructor/DI, no class inheritance; files ≤ 300–500 lines; **no fallbacks or mock data outside tests** — missing engine, failed call, unusable input, or ambiguous rights must throw a descriptive error. Non-overridable archive write-guard (reused). Translations of copyrighted sources must never be committed.

**Scale/Scope**: One periodical of ~78 issues (`PB-P001`) as the first target; reusable across any archived source. Each issue is a handful-to-dozens of pages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project's `.specify/memory/constitution.md` is the unfilled template (no ratified principles). In its absence the **de facto gates** are the house rules in `CLAUDE.md`, the translation/OCR policy in `AGENTS.md`, and the approved design record. Evaluated against those:

| Gate | Status | Notes |
|------|--------|-------|
| `@/` imports, no `any`/`as`/`@ts-ignore` | PASS | Enforced in all new modules. |
| Composition + DI, no inheritance | PASS | `claude` runner + clock injected, mirroring `OcrContext`. |
| Files ≤ 300–500 lines | PASS | Module split (below) keeps every file small. |
| No fallbacks / mock data outside tests | PASS | All failure modes throw descriptive errors (FR-013). |
| Reuse over reimplementation | PASS | Reuses `@/archive/*`, provenance, write-guard, exec runner. |
| Translation policy (AGENTS.md) | PASS | Machine-assisted label + original-language citation in every provenance record; PD-only committed translations (FR-006/007/008). |
| Faithful tool adoption (external CLI, not reimplemented) | PASS | Shells out to `claude`; does not call the Anthropic API. |

No violations → Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-source-translation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── cli.md           # Phase 1 output — command + flag contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── claude/                     # NEW — external Claude Code CLI adapter (mirrors src/ocr/)
│   ├── exec.ts                 #   reuse of the generic execCommand runner (see research)
│   ├── preflight.ts            #   assertClaudeAvailable() — fail loud if `claude` absent (FR-009)
│   └── client.ts               #   ClaudeCli.run(prompt, stdin) — one `claude -p` invocation
├── translate/                  # NEW — translation domain (page-chunked, idempotent)
│   ├── pages.ts                #   split issue.txt into per-page chunks on form-feed (\f)
│   ├── cleanup.ts              #   one page: OCR text -> corrected French (via ClaudeCli)
│   ├── translate-page.ts       #   one page: corrected French -> English (via ClaudeCli)
│   ├── issue.ts                #   translateIssue(): orchestrate pages, assemble, store
│   ├── source.ts               #   translateSource(): iterate issues, pacing, N-consecutive-fail abort
│   └── artifacts.ts            #   artifact paths + reuse @/archive provenance/store writes
├── cli/
│   ├── translate.ts            # NEW — runTranslate / runTranslateSource handlers
│   └── parse.ts                # EXTEND — add 'translate','translate-source' commands (or new parser)
└── translate-index.ts          # NEW — bin entry `translate` (mirrors src/index.ts dispatch)

tests/
├── unit/                       # pages split, cleanup/translate prompt building, artifact paths
└── integration/                # translateIssue/translateSource with a faked ClaudeCli + tmp archive
```

**Structure Decision**: A **second bin** (`translate`) is added to the existing `gallica-fetcher` package rather than new subcommands on the `gallica` bin — fetching and translating are distinct concerns, and a separate entry keeps each CLI's surface coherent (this also lands backlog `TASK-4 cli-bin-entry`). The translation domain lives under `src/translate/` and the external-CLI adapter under `src/claude/`, mirroring the existing `src/ocr/` shape. All archive I/O, provenance, checksums, and the write-guard are **reused** from `@/archive/*` — no duplication. `package.json` gains `bin: { "translate": "src/translate-index.ts" }` and a `translate` script.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
