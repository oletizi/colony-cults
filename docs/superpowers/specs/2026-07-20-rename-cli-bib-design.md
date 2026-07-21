# Design — Rename the CLI `gallica` → `bib` (flatten to match the docs)

Date: 2026-07-20
Branch: `feature/rename-cli-bib`
Status: approved-in-conversation, pending written-spec review

## Problem

The umbrella CLI is named `gallica` (bin: `gallica → src/index.ts`; package
`gallica-fetcher`), a name left over from when the project only mirrored BnF
Gallica. The project has since become a general, multi-source corpus/bibliography
tool (Papers Past, museums, Internet Archive, NZ/US press, translation…). A CLI
named after one of its data sources is a **mental-model trap**: it invites
Gallica-shaped assumptions to accrete across the general layer ("a nucleation
site for misbehavior").

Two concrete symptoms:

1. **The general front door is buried under a source name.** The bibliography
   SSOT surface is invoked today as `gallica bib <sub>` — the general command is
   nested inside a source-specific umbrella.
2. **The docs and the code disagree.** The documentation universally writes the
   commands flat as `bib <verb>` — not only `bib query-source`/`bib acquire`
   (~473 occurrences) but also the Gallica mirroring verbs, e.g. `bib
   fetch-source` (spec 012), `bib census`. The **code** is what diverges: SSOT
   verbs sit under `gallica bib`, and the Gallica verbs sit at `gallica`
   top-level. No shipped `bib` command exists at all.

Adjacent, folded in here by decision: **TASK-4 (cli-bin-entry)** — the `bin`
points at TypeScript (`src/index.ts`), so a linked/installed bin cannot run
without `tsx`; the bin field is a latent trap.

## Decision

Rename the umbrella CLI to **`bib`** and flatten its command tree so the **code
conforms to the already-written docs**. `gallica` survives only where it is
accurate (the Gallica source adapter and data), never as the umbrella identity.

This was chosen over `corpus` (considered, then rejected) precisely because the
docs already say `bib` — naming the CLI `bib` makes ~473 doc references true with
zero rewrite, and is the lowest-churn honest fix.

### 1. Bin + package

- `package.json`: `bin: { "gallica": "src/index.ts" }` → `bin: { "bib":
  "dist/index.js" }` (see runnability below); package `name: "gallica-fetcher"`
  → `"bib"`.
- The `translate` bin keeps its **command name** (`translate`, out of scope to
  rename) but rides the same build: `bin.translate → dist/translate-index.js`, so
  both bins are consistently runnable rather than one runnable + one dangling TS
  bin. esbuild takes both entry points in one invocation (trivially free).

### 2. Command tree — flatten

The `bib` bin dispatches **all verbs flat at the top level**, merging today's two
dispatchers into one:

- Former SSOT verbs (were `gallica bib <sub>`): `bib query-source`, `bib
  acquire`, `bib coverage`, `bib discover`, `bib migrate`, `bib show`, `bib
  validate`, `bib regenerate`, `bib inventory`, `bib verify-member`, `bib
  promote`, `bib exclude-member`, `bib reconcile`, `bib rights-assess`.
- Former Gallica mirroring verbs (were `gallica <verb>` top-level): `bib census`,
  `bib fetch-source`, `bib fetch-issue`, `bib ocr`, `bib restore-images`.

The two verb sets do **not collide** (verified). The old `gallica bib …`
double-nesting disappears. `gallica` as an umbrella verb/prefix is gone.

`gallica` remains correct and untouched where it names Gallica specifically:
`src/gallica/**`, the Gallica `SourceConfig`, `gallicaArk` model fields,
`gallica.bnf.fr` URLs, and `bib census`/`bib fetch-source` operating on Gallica
periodicals. The word is not purged; the umbrella identity is.

### 3. Runnable bin (closes TASK-4)

Make `bib` genuinely runnable as a standalone bin — no `tsx` needed at runtime:

- Add **esbuild** (one devDependency) and a `build` script that bundles both CLI
  entry points (`src/index.ts` → `dist/index.js`, `src/translate-index.ts` →
  `dist/translate-index.js`):
  - ESM output, `--packages=external` (first-party `src/**` bundled with `@/`
    aliases resolved; all `node_modules` deps — Playwright, AWS SDK, etc. — left
    as runtime requires, satisfied by the package's runtime `dependencies`).
  - `--banner:js='#!/usr/bin/env node'` to preserve the shebang on the bundle.
- `bin: { "bib": "dist/index.js", "translate": "dist/translate-index.js" }`; add
  a `prepare` script so `npm install`/`npm link` builds `dist/`. `dist/` is
  gitignored.
- `import.meta.url`-relative reads (e.g. `readPackageVersion`'s `new
  URL('../package.json', import.meta.url)`) resolve correctly from `dist/…` up to
  the repo-root `package.json` — verified as part of implementation.
- Local dev continues to work unchanged via `npm run` / `tsx` (e.g. `npm run bib
  -- query-source …`); the compiled bin is what makes the bare `bib <verb>`
  documented form real when linked/installed.

Rationale for esbuild over a `tsx` wrapper: `tsx` is a devDependency, so a
`--production`/linked install would not have it — the exact TASK-4 trap. Bundling
removes the runtime `tsx` dependency and resolves the `@/` aliases that a plain
`tsc` build would leave dangling.

### 4. Docs / skills

- Update the ~35 `gallica <verb>` / `npm run gallica` / help-text/tagline
  references to `bib <verb>` (chiefly `src/index.ts` `HELP_TEXT`, README, a few
  quickstarts).
- The fetching-online-sources skill, the CLAUDE.md commandment, and the ~473
  `bib <verb>` docs are already correct — **no change**.

### 5. Tests (TDD)

- Drive the change test-first at the CLI dispatch + help boundary:
  - `bib <verb>` routes correctly for both a former-SSOT verb (e.g.
    `query-source`) and a former-Gallica verb (e.g. `census`, `fetch-source`).
  - Help text advertises `bib` (not `gallica`) and lists the flat verb set.
  - An unknown verb fails loud (unchanged behavior, new name).
  - The built `dist/index.js` runs under plain `node` and prints help/version
    (proves the runnable-bin/TASK-4 fix).
- Existing tests that reference `gallica.bnf.fr` URLs / `gallicaArk` / the Gallica
  client are **untouched** — that is Gallica data, correctly named. Two tests that
  assert CLI help/name (`translate-source-cli`, and any `gallica`-help assertion)
  are updated to the new name.

## Governance

Direct TDD change on `feature/rename-cli-bib` (no full Spec Kit spec — mechanical
rename with clear test coverage). This design doc is the durable record. On
completion, **rescope/close TASK-4** (its runnability concern is resolved here)
and note the rename in the session/journal.

## Out of scope

- Renaming the `translate` bin's command surface, `src/gallica/**` internals, or
  any Gallica-accurate name.
- The blocked Papers Past census (SRCH-0020) — separate work, gated on TASK-43
  (production TailscaleRunner) or a clean/NZ-geo IP.
- Publishing the package to a registry.

## Acceptance

- `bib <verb>` works for every former SSOT and former Gallica verb; `gallica`
  is no longer an umbrella command anywhere in code, help, or package metadata.
- `node dist/index.js --help` runs with no `tsx` present and shows `bib` help.
- Full `npm test` + `npm run typecheck` green.
- Docs contain no stale `gallica <verb>` / `npm run gallica` invocations.
