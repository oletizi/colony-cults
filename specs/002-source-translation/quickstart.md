# Quickstart / Validation: Source Translation

Runnable validation scenarios that prove the feature works end-to-end. Contracts: [contracts/cli.md](./contracts/cli.md). Entities: [data-model.md](./data-model.md).

## Prerequisites

- Node 20 + `tsx` (already in the package).
- The private archive present at `../colony-cults-archive` relative to the public repo root — confirmed at `/Users/orion/work/colony-cults-archive`, containing `PB-P001` (*La Nouvelle France*) issues with `issue.txt` files.
- For real (non-dry-run) translation: the **Claude Code CLI** (`claude`) installed and authenticated (`claude` is on PATH; verify with `claude --version`).

## Setup

```bash
npm install
npm run typecheck   # tsc --noEmit — must pass with no any/as/@ts-ignore
```

## Scenario A — Dry-run a single issue (no engine required) — validates US3, FR-010

```bash
tsx src/translate-index.ts translate bpt6k5606854m --dry-run
```

**Expect**: reports the issue's rights status (`public-domain`), that it would translate ~21 pages (the 1881-09-15 issue has 20 form-feeds), and writes nothing. Re-running leaves the archive byte-identical.

## Scenario B — Translate a single public-domain issue — validates US1, FR-002..007

```bash
tsx src/translate-index.ts translate bpt6k5606854m
```

**Expect**: `issue.fr.txt` (corrected French) and `issue.en.txt` (English) appear in the issue dir alongside `issue.txt`, each with a `.yml` companion whose fields include `engine: claude-code-cli`, a `model`, a date, `translation: machine-assisted`, and the original-language citation. The English is derived from the corrected French (the `.fr.txt` always exists whenever `.en.txt` does).

## Scenario C — Idempotent re-run + resume — validates FR-011, FR-012, SC-008

```bash
tsx src/translate-index.ts translate bpt6k5606854m          # second run
```

**Expect**: already-translated issue is skipped (reported "already present"); no engine calls. Simulate an interruption by deleting one page intermediate, then re-run: only that page is reprocessed; completed pages are not.

## Scenario D — Refuse a non-public-domain source — validates FR-008, SC-005

Point at an issue whose stored provenance `rights_status` is not `public-domain`.

**Expect**: the tool refuses with a descriptive error, writes nothing, exits non-zero (a `--dry-run` instead reports the rights status without a hard refusal).

## Scenario E — Whole-source run with pacing + consecutive-failure abort — validates US2, FR-015, FR-017

```bash
tsx src/translate-index.ts translate-source PB-P001 --dry-run   # preview
tsx src/translate-index.ts translate-source PB-P001             # real run
```

**Expect**: not-yet-translated issues are translated, already-translated ones skipped; calls are paced; a per-issue outcome report prints (translated / skipped / refused / failed / incomplete). In an integration test with a faked `claude` runner forced to fail, the run aborts after 3 consecutive failures and reports it.

## Scenario F — Engine absent — validates FR-009, SC-006

With `claude` not on PATH (or the preflight faked absent), run Scenario B.

**Expect**: fails loud before any write, naming the missing `claude` CLI and how to install/authenticate it. A `--dry-run` still works (no engine needed).

## Automated tests

```bash
npm test   # vitest run
```

- **Unit**: `splitPages` on a real `issue.txt` fixture (asserts page count from `\f`); cleanup/translation prompt construction; artifact path derivation; provenance field population (machine-assisted label + citation).
- **Integration**: `translateIssue` / `translateSource` against a **tmp archive root** with a **faked `ClaudeCli`** (deterministic outputs) and an injected clock — asserts artifacts + `.yml` land alongside the source, idempotent skip, per-page resume, rights refusal, engine-absent preflight, and the N=3 consecutive-failure abort. No real `claude` invocation in tests.
