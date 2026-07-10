#!/usr/bin/env bash
#
# Reproducible corpus-snapshot regeneration.
#
# Deterministically rebuilds site/data/<sourceId>.json from the archive commit
# PINNED in site/data/archive-source.json. It sets up a clean, sparse (text +
# metadata, no image binaries), detached archive worktree at that exact ref and
# runs the generator against it -- so the same pin always yields the same
# snapshot, and no ad-hoc/dirty clone can leak an unknown state into the data.
#
# The archive is private, so this step needs archive access; the public build
# (npm run site:build) never does -- it reads the committed snapshot.
#
# Usage:  npm run snapshot           (writes site/data)
#         bash scripts/regen-snapshot.sh <out-dir>   (writes <out-dir>; used by snapshot:check)
#
# Env overrides:
#   ARCHIVE_REPO      local clone of the archive repo (default: ~/work/colony-cults-archive)
#   ARCHIVE_WORKTREE  where the pinned worktree lives (default: <repo-parent>/archive-snapshot)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="$REPO_ROOT/site/data/archive-source.json"
OUT_DIR="${1:-$REPO_ROOT/site/data}"

REF="$(node -p "require('$PIN').ref")"
ARCHIVE_REPO="${ARCHIVE_REPO:-$HOME/work/colony-cults-archive}"
ARCHIVE_WORKTREE="${ARCHIVE_WORKTREE:-$(dirname "$REPO_ROOT")/archive-snapshot}"

if [ ! -d "$ARCHIVE_REPO/.git" ]; then
  echo "regen-snapshot: no archive clone at ARCHIVE_REPO=$ARCHIVE_REPO" >&2
  echo "  Clone it (private) or set ARCHIVE_REPO to a local clone of $(node -p "require('$PIN').repo")." >&2
  exit 1
fi

git -C "$ARCHIVE_REPO" fetch --quiet origin || true

# Clean, detached worktree pinned to the exact ref. The archive is metadata-only
# (image binaries live in B2), so a full checkout is small -- no sparse needed.
if git -C "$ARCHIVE_REPO" worktree list --porcelain | grep -qx "worktree $ARCHIVE_WORKTREE"; then
  git -C "$ARCHIVE_WORKTREE" sparse-checkout disable 2>/dev/null || true
  git -C "$ARCHIVE_WORKTREE" checkout --quiet --detach "$REF"
  git -C "$ARCHIVE_WORKTREE" reset --hard --quiet "$REF"
else
  git -C "$ARCHIVE_REPO" worktree add --quiet --detach "$ARCHIVE_WORKTREE" "$REF"
fi

echo "regen-snapshot: archive worktree $ARCHIVE_WORKTREE @ $(git -C "$ARCHIVE_WORKTREE" rev-parse --short HEAD) (pinned $REF)"
mkdir -p "$OUT_DIR"
CORPUS_ARCHIVE_PATH="$ARCHIVE_WORKTREE" CORPUS_SNAPSHOT_DIR="$OUT_DIR" npm run --silent site:snapshot
