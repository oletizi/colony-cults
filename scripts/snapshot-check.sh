#!/usr/bin/env bash
#
# Snapshot drift guard: regenerate the corpus snapshot from the pinned archive
# ref into a temp dir and diff it against the committed site/data/*.json. Exits
# non-zero on any difference -- so a stale committed snapshot (or one hand-edited
# / generated from an unpinned/dirty archive) is caught mechanically. This is the
# reproducibility proof; runnable in CI (given archive access).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bash "$REPO_ROOT/scripts/regen-snapshot.sh" "$TMP" >/dev/null

fail=0
for committed in "$REPO_ROOT"/site/data/*.json.gz; do
  name="$(basename "$committed")"
  fresh="$TMP/$name"
  if [ ! -f "$fresh" ]; then
    echo "snapshot:check DRIFT -- $name has no counterpart in a fresh regen" >&2
    fail=1
  # Compare DECOMPRESSED content so gzip-encoding differences (zlib version) do
  # not cause false drift -- only real content drift fails.
  elif ! diff -q <(gunzip -c "$committed") <(gunzip -c "$fresh") >/dev/null; then
    echo "snapshot:check DRIFT -- $name differs from a fresh regen (run: npm run snapshot)" >&2
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "snapshot:check OK -- committed snapshot matches a fresh regen from the pinned archive ref"
fi
exit "$fail"
