# Contract: `bib coverage` CLI subaction

The single derived-view command. Added to the existing bibliography CLI dispatch
(`src/cli/bibliography.ts`, alongside `show` / `validate` / `inventory` / …).

## Invocation

```
bib coverage [--json]
```

- No positional arguments (reports over the whole corpus).
- `--json` → machine-readable structured output (the `CoverageReport` shape from
  `data-model.md`). Without it → human-readable text.

## Behavior contract

- **Reads** committed source only: `bibliography/sources/*.yml` + `bibliography/search-log.yml`
  (via the shipped loader). **Writes nothing** to disk.
- **Deterministic**: two runs against identical committed state produce byte-identical output.
- **Fails loud** if the bibliography fails validation (it does not print a partial report over
  invalid data) — surfacing the same validation errors as `bib validate`.
- Exit `0` on a successfully generated report (including an all-empty corpus).

## Output sections (both text and `--json`)

1. **Per-campaign counts** — for each source-group: members by lifecycle state; `actualMemberCount`
   (derived, per-work); `knownMemberCount` (authored or `unknown`); `gap` as a number **or** the
   literal `unknown`.
2. **Evidence-class distribution** — corpus-wide counts per class, plus `unclassified`.
3. **Unresolved-references register** — unresolved `references[]` + `suspected[]` grouped by
   campaign, plus an explicit ungrouped ("no campaign") bucket for references on sources with no
   `partOf`.
4. **Search history** — repository × campaign matrix (last-searched date, open questions) **and**
   a repository-axis rollup (each repository as a research object).

## Invariants (assertable)

- **INV-1**: Output contains **no** headline coverage percentage anywhere.
- **INV-2**: Every gap/denominator that is not known renders as the literal `unknown` (never a
  blank, `0`, or a percentage).
- **INV-3**: A work held at multiple archives appears **once** in lifecycle counts; copy counts
  appear only in the separate per-archive view.
- **INV-4**: Nothing is written to the working tree by the command (verifiable: `git status`
  clean after a run).
- **INV-5**: `--json` output carries the same information as the text output (same counts,
  register entries, and history rows).

## Example (text, illustrative)

```
Campaign PB-P004 (French trial and legal proceedings…)
  members: approved-for-acquisition 3 | discovered 1 | excluded 1   (actual works: 5)
  believed extent (knownMemberCount): unknown        gap: unknown
Evidence classes: trial-record 4 | pamphlet 2 | unclassified 5
Unresolved references:
  PB-P004:
    - "la Nouvelle France" (journal, explicit-citation) — cited in PB-P007
  [no campaign]:
    - (none)
  suspected:
    PB-P004:
      - additional appeal-court records (basis: trial-testimony)
Search history:
  PB-P004 × State Library of Queensland  last: 2026-07-03  open: appeal-court records not online
  Repository rollup:
    State Library of Queensland  last: 2026-07-03  open: 1
```
