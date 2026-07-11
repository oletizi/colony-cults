# CLI Contract: `translate`

A second bin in the `gallica-fetcher` package, mirroring the `gallica` CLI's parse/dispatch/flag conventions (`src/index.ts`, `src/cli/parse.ts`). Text in → stdout; errors → stderr, non-zero exit.

## Invocation

```text
translate <command> <id> [options]
```

## Commands

| Command | Positional | Meaning |
|---------|-----------|---------|
| `translate` | `<issueArk>` | Translate a single archived issue (cleanup → translate, page by page; assemble; store). |
| `translate-source` | `<sourceId>` | Iterate a source's archived issues, translating each not-yet-translated one. |

The positional is required; a missing positional fails loud naming what was expected (mirrors `REQUIRED_POSITIONAL_NAME`).

## Options (global boolean flags)

| Flag | Meaning |
|------|---------|
| `--dry-run` | Report intended per-issue work (translate / skip / refuse-on-rights) + rights status; write nothing (FR-010). Does not require `claude` to be present. |
| `--force` | Re-translate issues/pages that already have artifacts (FR-011). |
| `--model <name>` | Claude model alias or full name to pin for the run; recorded in provenance. Optional; a default is used if omitted. |
| `--help`, `-h` | Show help. |
| `--version`, `-v` | Show version (shared package version). |

## Behavior contract

1. **Preflight** (`claude` availability) fires only when a real translation will run — not on `--dry-run` (FR-009). On absence: fail loud naming the tool + how to install/authenticate; exit non-zero; write nothing.
2. **Rights gate**: before translating an issue, read `rights_status` from the issue's stored page provenance; if not `public-domain`, **refuse** (fail loud, write nothing) (FR-008). `--dry-run` reports the rights status instead of refusing hard.
3. **Per-issue pipeline**: locate the issue dir offline (`findIssueDir`), read `issue.txt`, split into page chunks on `\f`, and for each page run cleanup then translation via the injected `claude` runner; persist each page intermediate idempotently; assemble whole-issue `issue.fr.txt` + `issue.en.txt`; write each with a `.yml` provenance companion.
4. **Resumability**: a present, checksum-recorded page/issue is skipped unless `--force` (reuses `isAssetRecorded`).
5. **Whole-source**: skip already-translated issues; pace `claude` calls politely; **abort after N=3 consecutive issue failures** (FR-017); print a per-issue outcome report (FR-015).
6. **No fallbacks**: missing engine, failed `claude` call, unusable input, or ambiguous rights → descriptive error, no partial/fabricated output (FR-013).

## Exit codes

- `0` — completed (including a whole-source run that skipped everything or reported per-issue failures without hitting the consecutive-failure abort, per the report).
- non-zero — fail-loud precondition (engine absent, rights refusal on a non-dry-run single issue, unresolved identifier, unusable input) or a consecutive-failure abort.

## Help text (shape)

```text
translate - Turn archived French OCR into corrected French + English (via the Claude Code CLI)

Usage:
  translate <command> <id> [options]

Commands:
  translate <issueArk>        Translate one archived issue
  translate-source <sourceId> Translate every archived issue of a source

Options:
  --help, -h      Show this help message
  --version, -v   Show version
  --dry-run       Report intended work + rights; write nothing
  --force         Re-translate artifacts that already exist
  --model <name>  Claude model to pin (recorded in provenance)
```
