# CLI Contract: `bib fetch-source --pages`

## Synopsis

```
bib fetch-source <documentArk> --source-id <id> [--pages <spec>] [--object-store] [--dry-run] [--ocr] [--slug <slug>] [--force]
```

`--pages <spec>` is **new and optional**. All other flags and behavior are unchanged.

## `--pages <spec>`

- **Grammar**: comma-separated tokens; each token `N` (single folio) or `A-B` (inclusive range, `A <= B`). Example specs: `48-50`, `48,50,52`, `48-50,55`.
- **Meaning**: acquire ONLY the named IIIF folios of `<documentArk>` (masters + per-page provenance); leave the rest un-acquired. Folios are physical image ordinals (the `f<N>` IIIF index), not printed page numbers.
- **Absent**: whole-document acquisition, byte-for-byte identical to today.

## Behavior

| Condition | Outcome |
|-----------|---------|
| valid `--pages`, all folios in `1..pageCount`, public-domain | fetch exactly the selected folios; record `RepositoryRecord.folios`; summary reports fetched/skipped over the selected set |
| `--pages` absent | unchanged whole-document fetch |
| `--dry-run --pages` | report ONLY the selected folios (count + size estimate); write nothing |
| any folio `< 1` or `> pageCount` | **fail loud**, exit non-zero, write nothing |
| malformed token / reversed range `50-48` / empty spec | **fail loud** at parse, exit non-zero, write nothing |
| duplicate/overlapping tokens (`48-50,49`) | de-duplicate to `{48,49,50}`; NOT an error |
| rights not `public-domain` | REFUSE (no download) — unchanged rights gate, applies to excerpts too |
| re-run same excerpt | idempotent — already-held folios skipped |

## Scope

- Honored on the single-document path (`fetch-source`). On the periodical `fetch-issue` path, `--pages` is a **usage error** (exit non-zero) in v1.

## Exit codes

- `0` — requested folios acquired (or dry-run reported).
- non-zero — parse error, out-of-bounds folio, rights refusal, `--pages` on the periodical path, or any fetch failure. No partial commit on a fail-loud path.
