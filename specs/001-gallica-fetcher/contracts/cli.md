# Contract: CLI command surface

Invoked via `tsx` (e.g. `pnpm gallica <command> [args] [flags]`). Text out → stdout; errors → stderr, non-zero exit. All commands are usable independently.

## Global flags

| Flag | Meaning |
|---|---|
| `--dry-run` | Report intended actions (arks, target paths, per-item rights status, estimated size); write nothing. |
| `--force` | Re-fetch/regenerate assets that already exist and are checksum-recorded. |
| `--verify` | Re-hash existing assets against recorded checksums; report mismatches (no download). |
| `--ocr` | Opt into OCR during a fetch (default: images-only). |

## `census <periodicalArk>`

Build/refresh the per-source census.

- **In**: periodical ark (e.g. `ark:/12148/cb328261098/date` or `cb328261098`).
- **Out**: deterministic JSON at `data/census/<sourceId>-<slug>.json` (public repo). Prints issue count + span.
- **Errors**: non-periodical ark; host unreachable after backoff.
- `--dry-run`: prints where the file would go + issue count; writes nothing.

## `fetch-issue <issueArk>`

Fetch one issue's full-resolution page images into the private archive.

- **Pre**: rights gate passes (else throw, download nothing).
- **Out**: `f001.jpg…` + per-asset provenance sidecars under the archive issue dir. With `--ocr`, also `issue.pdf` + `issue.txt`.
- **Resumability**: skips pages already present with a recorded sha256 unless `--force`.
- **Errors**: rights not public-domain; write path escapes archive; 403 after backoff.

## `fetch-source <periodicalArk>`

Fetch every issue in the source's census (builds census first if absent).

- Iterates issues; each issue independently rights-gated and resumable.
- `--dry-run`: per-issue rights status + intended paths + estimated total size; writes nothing.
- Partial prior run resumes without re-downloading verified assets.

## `ocr <issueArk>`

OCR already-fetched images for an issue (no re-download).

- **Pre**: images present; OCR toolchain preflight passes (else throw with install guidance).
- **Out**: `issue.pdf` (searchable PDF/A) + `issue.txt` + provenance; sets `ocrStatus`.
- **Errors**: images missing; toolchain (incl. `fra`) missing.

## Cross-cutting guarantees

- Preservation assets (`page-image` / `pdf-a` / `ocr-text`) are ONLY ever written inside `../colony-cults-archive`; any attempt otherwise throws (no override). Census JSON is the only public-repo output.
- No fallbacks/mock data: any missing capability/data throws with a descriptive message.
