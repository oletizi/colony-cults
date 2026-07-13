# Runbook: Close the PB-P004 bibliography lifecycle (TASK-17)

> **⚠️ STATUS 2026-07-12 — READ THIS FIRST. This runbook was rewritten.**
> The acquisition it originally described is **already done**. Do not re-run it.

## What happened

- **The acquisition is complete upstream.** All 5 sources (PB-P007…P011) were
  fetched to **B2 + the archive** by other sessions and are in the archive repo's
  `origin/main`: `652171e` PB-P007 (174), `de34b2c` PB-P008 (60), `ed2f833`
  PB-P009 (5), `30c46ed` PB-P010 (15), `a4aec08` PB-P011 (36). **There is no
  acquisition left to run.**
- **Why the earlier attempt jammed:** `bib acquire PB-P007 --checkpoint` found the
  masters already recorded (`0 new`); its checkpoint push was non-fast-forward; and
  `pull --rebase` on the **shared** archive clone (`~/work/colony-cults-archive`)
  hit add/add conflicts. Root cause: **multiple sessions were sharing one archive
  working tree.** `--checkpoint`'s add-all even swept another session's uncommitted
  (and *superseded*) translation drafts into a redundant commit `568c51c` — preserved
  at branch `backup/pb-p007-redundant-checkpoint`. **Nothing was lost** (those drafts
  are older versions of translations already refined + PR-merged into `origin/main`).
- **Policy change (do this from now on):** we **no longer use a shared archive
  working tree**. The archive git repo is ~13 MB of text/provenance (masters live in
  B2), so each session **clones its own** archive. **Do NOT use
  `~/work/colony-cults-archive`** — it is being retired; do not sync or push it.
  (Follow-ups: TASK-18 scope `--checkpoint`'s add; TASK-19 stop defaulting
  `resolveArchiveRoot` to a shared clone.)

## What's left: the bibliography lifecycle tail (reduced TASK-17)

The masters are in B2. The only unfinished piece is the **code-repo bibliography
lifecycle**: PB-P007…P011 still read `status: to-collect`. Regenerate them to the
acquired state from the (already-committed) archive provenance.

## Procedure

1. **Clone your own archive** (current with `origin/main`; already has all 5):
   ```
   git clone --single-branch --branch main \
     git@github.com:oletizi/colony-cults-archive.git \
     ~/work/colony-cults-work/acquire-pb-p004-corpus-archive
   export COLONY_ARCHIVE_ROOT=~/work/colony-cults-work/acquire-pb-p004-corpus-archive
   ```
2. **Regenerate + verify** from this worktree
   (`~/work/colony-cults-work/acquire-pb-p004-corpus`):
   ```
   npx tsx src/index.ts bib regenerate    # derives RepositoryRecord state from provenance
   npx tsx src/index.ts bib validate      # must be clean
   npx tsx src/index.ts bib coverage      # PB-P004 should reflect acquisition
   ```
   Confirm PB-P007…P011 RepositoryRecords advanced past `to-collect`. If `regenerate`
   does not move them, inspect one `bibliography/sources/PB-P00X.yml` — the archive
   provenance must carry the `object_store` handle it derives from.
3. **Commit on this branch** (`campaign/acquire-pb-p004-corpus`) and push:
   ```
   git add bibliography/
   git commit -m "acquire(PB-P004): regenerate lifecycle — PB-P007..P011 acquired"
   git push
   ```
4. **PR** → merge when green.
5. **Close the task:**
   ```
   stackctl backlog done TASK-17 --reason "acquired upstream; bibliography lifecycle regenerated" --apply
   ```

## Do NOT

- Do **not** `reset`/`pull`/`push` `~/work/colony-cults-archive` (the shared clone).
  Its redundant local `568c51c` must never be pushed. It's retired.
- Do **not** re-run `bib acquire` — masters are already in B2; it's a no-op that
  risks re-sweeping files.

## The 5 sources (already acquired — reference only)

| Source | Ark | Pages | Archive commit |
|---|---|--:|---|
| PB-P007 | `bpt6k5785971m` | 174 | `652171e` |
| PB-P008 | `bpt6k1914256x` | 60 | `de34b2c` |
| PB-P009 | `bpt6k5806269g` | 5 | `ed2f833` |
| PB-P010 | `bpt6k5805671m` | 15 | `30c46ed` |
| PB-P011 | `bpt6k58040250` | 36 | `a4aec08` |
