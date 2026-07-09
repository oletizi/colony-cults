# Quickstart / Validation: Archive Object Store (Backblaze B2)

Runnable validation that the object-store backend works end to end. Do NOT run
against the shared archive clone — use the dedicated worktree (step 1).

## Prerequisites

- Node 20 + `tsx`, repo deps installed (`npm install`), plus `@aws-sdk/client-s3`.
- B2 credentials at `~/.config/backblaze/b2-credentials.txt` (`keyID` / `keyName` /
  `applicationKey`; note the tab after `applicationKey:`).
- Environment (non-secret config):
  ```sh
  export COLONY_S3_BUCKET=colony-cults
  export COLONY_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
  export COLONY_S3_REGION=us-west-004
  # COLONY_B2_CREDENTIALS defaults to ~/.config/backblaze/b2-credentials.txt
  ```

## Step 1 — Create the isolated archive worktree (FR-014)

The shared clone `../colony-cults-archive` is on `main` with a dirty tree owned by
the translation session. Never write there. Create your own worktree on its own
branch:

```sh
git -C ../colony-cults-archive worktree add \
  ../colony-cults-archive-object-store -b wt/object-store
export COLONY_ARCHIVE_ROOT="$(cd ../colony-cults-archive-object-store && pwd)"
```

Add the image-master gitignore in the worktree (go-forward-only; existing tracked
masters are untouched):

```sh
printf 'archive/cases/**/*.jpg\narchive/cases/**/*.jpeg\narchive/cases/**/*.png\n' \
  >> "$COLONY_ARCHIVE_ROOT/.gitignore"
```

## Step 2 — Unit tests (no network)

```sh
npm test
```

Expected: `ObjectStore` fake round-trips (put→head→get), `b2-config` parses the
tab-after-colon `applicationKey`, `object-key` mirrors the archive path,
provenance serializes/parses the `size` + `object_store` block byte-identically.

## Step 3 — Real B2 round-trip (opt-in integration test)

```sh
COLONY_S3_IT=1 npm test -- integration
```

Expected: a temp key put→head(sha256 matches)→get(bytes match)→delete against the
live endpoint. Skipped automatically when creds/`COLONY_S3_IT` are absent.

## Step 4 — Capture one issue end to end (US1)

Fetch a single small issue with the backend enabled, against the worktree:

```sh
npm run gallica -- fetch-issue --source PB-P001 --ark <ark> \
  --object-store --archive-root "$COLONY_ARCHIVE_ROOT"
```

> The `--object-store` flag is opt-in — it enables the B2 backend (and fails loud
> if `COLONY_S3_*` config or credentials are missing). Without it, the fetcher
> writes locally as before.

Validate:

- **No image bytes in git** (SC-001):
  ```sh
  git -C "$COLONY_ARCHIVE_ROOT" status --porcelain | grep -E '\.(jpg|jpeg|png)$' && echo FAIL || echo OK
  ```
- **Objects in B2**: each `f###.jpg` exists at its mirrored key (via `--verify` in
  step 5, or an `aws s3 ls`/`rclone ls` against the bucket).
- **Provenance records object_store**: each `f###.yml` has an `object_store` block
  (provider/bucket/key/endpoint) plus `sha256` and `size`.

## Step 5 — Resumability + verify (US2)

```sh
# Re-run: every master is skipped, zero uploads (SC-003)
npm run gallica -- fetch-issue --source PB-P001 --ark <ark> --object-store --archive-root "$COLONY_ARCHIVE_ROOT"

# Verify against B2: all match (SC-002/SC-004)
npm run gallica -- fetch-issue --source PB-P001 --ark <ark> --object-store --archive-root "$COLONY_ARCHIVE_ROOT" --verify

# Force re-upload one master, confirm it re-uploads (FR-007)
npm run gallica -- fetch-issue --source PB-P001 --ark <ark> --object-store --archive-root "$COLONY_ARCHIVE_ROOT" --force
```

Expected: re-run reports all skipped; `--verify` reports all OK; deleting/corrupting
one object then `--verify` reports exactly that one as a mismatch (SC-004);
missing creds → loud non-zero failure, never a git-written image byte (SC-005).

## Step 6 — Straggler capture (US4)

Capture the ~5 sleep-interrupted PB-P001 issues via the backend (masters → B2,
provenance → git, no image bytes in git). Confirm as in steps 4–5 (SC-006).

## Cleanup

```sh
git -C ../colony-cults-archive worktree remove ../colony-cults-archive-object-store
```

## Out of scope (do NOT do here)

The one-time git-history purge (`git-filter-repo --path-glob '*.jpg'
--invert-paths` + force-push) that reclaims the ~2 GB is blocked on the translation
session quiescing and is a separate, coordinated operation.
