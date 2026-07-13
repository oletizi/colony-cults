# Runbook: Acquire the PB-P004 legal corpus (TASK-17)

Operational campaign — **no new code**. Close the 5 `approved-for-acquisition`
gaps in the PB-P004 (Marquis de Rays trial / legal) source-group by acquiring the
Gallica monographs to B2 + provenance, then advancing each RepositoryRecord to
`archived`. Hand this file to a fresh session; it is self-contained.

## Where to work

- **Worktree:** `~/work/colony-cults-work/acquire-pb-p004-corpus` (deps installed)
- **Branch:** `campaign/acquire-pb-p004-corpus` (off `main`) — bibliography lifecycle
  commits land here.
- **Archive clone (written to):** `~/work/colony-cults-archive` — page-image masters
  go to **B2**; per-asset provenance is committed **in this clone** (a separate repo).

## Environment (export before running)

```
export COLONY_ARCHIVE_ROOT=/Users/orion/work/colony-cults-archive
export COLONY_S3_BUCKET=colony-cults
export COLONY_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
export COLONY_S3_REGION=us-west-004
# B2 creds are read from ~/.config/backblaze/b2-credentials.txt by the tool.
```

CLI entry is `gallica bib …` → run as `npx tsx src/index.ts bib …` from the worktree.

## The 5 gaps (all validated via --dry-run, all public-domain)

| Source | Ark | Pages | ~Size | Title |
|---|---|--:|--:|---|
| PB-P007 | `bpt6k5785971m` | 174 | 4.9 MB | La Vérité sur la colonie de Port-Breton… |
| PB-P008 | `bpt6k1914256x` | 60 | **95.6 MB** | Cour de Paris, Chambre des appels — affaire de Port-Breton |
| PB-P009 | `bpt6k5806269g` | 5 | 1.8 MB | La Nouvelle France : colonie libre… (clôture 1ʳᵉ série) |
| PB-P010 | `bpt6k5805671m` | 15 | 10.1 MB | Colonie libre de Port-Breton : [circulaire ministérielle] |
| PB-P011 | `bpt6k58040250` | 36 | 1.1 MB | La colonie libre de Port-Breton : Nouvelle France (conférence) |

~290 pages, ~113 MB total. PB-P008 is by far the largest.

## Per-source procedure (repeat for PB-P007 … PB-P011)

1. **Dry-run** (confirms ark / pages / target; writes nothing):
   ```
   npx tsx src/index.ts bib acquire PB-P00X --object-store --dry-run
   ```
2. **Acquire** (fetch images → B2, write provenance into the archive clone; the
   `--checkpoint` flag commits **and pushes** the archive per unit so a killed run
   doesn't lose work):
   ```
   npx tsx src/index.ts bib acquire PB-P00X --object-store --checkpoint
   ```
3. **Regenerate the bibliography** from the new archive provenance (advances the
   RepositoryRecord `to-collect →` acquired; `bib acquire` does NOT auto-run this):
   ```
   npx tsx src/index.ts bib regenerate
   npx tsx src/index.ts bib validate    # must be clean
   ```
4. **Confirm the gap closed:** the source's RepositoryRecord `status:` in
   `bibliography/sources/PB-P00X.yml` has advanced (expect `collected`/`archived`)
   and carries an `object_store` handle; masters are in B2.
5. **Commit on this branch** (bibliography change only — archive commits were made
   by `--checkpoint` in the archive clone):
   ```
   git add bibliography/ && git commit -m "acquire(PB-P00X): <title> — <N> pages to B2"
   git push
   ```

## Checklist

- [ ] PB-P007 — acquire · regenerate · verify · commit
- [ ] PB-P008 — acquire · regenerate · verify · commit  (large: 60 pages / ~96 MB)
- [ ] PB-P009 — acquire · regenerate · verify · commit
- [ ] PB-P010 — acquire · regenerate · verify · commit
- [ ] PB-P011 — acquire · regenerate · verify · commit
- [ ] `npx tsx src/index.ts bib coverage` — PB-P004 members reflect acquisition; no regressions
- [ ] Open a PR for `campaign/acquire-pb-p004-corpus` → merge when green
- [ ] `stackctl backlog done TASK-17 --reason "acquired PB-P007..P011 to B2" --apply`

## Cautions

- **Acquisition is Class A (writes/uploads).** The B2 **download**-cap
  (`download_cap_exceeded`) does NOT block acquisition — proceed regardless.
- **The archive clone is shared** — other sessions commit to it too. `--checkpoint`
  pushes per unit; if a push is rejected (non-fast-forward), `git -C
  $COLONY_ARCHIVE_ROOT pull --rebase` and retry. Never force-push the archive.
- **Rotate the exposed B2 key (TASK-7)** before wider use; if rotated, update
  `~/.config/backblaze/b2-credentials.txt`.
- Commit/push early and often — both the campaign branch and the archive clone.

## Pointers

- Backlog: **TASK-17** (`acquire-pb-p004-corpus`).
- Acquire contract: `specs/006-source-group-acquisition/contracts/cli-commands.md`
  (`bib acquire <id> [--archive] [--object-store] [--dry-run] [--checkpoint]`).
- Gap source of truth: `npx tsx src/index.ts bib coverage` (PB-P004 campaign).
