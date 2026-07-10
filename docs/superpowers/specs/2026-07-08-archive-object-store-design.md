# Design: Archive Object Store (`impl:feature/archive-object-store`)

- Date: 2026-07-08
- Roadmap item: `impl:feature/archive-object-store`
- Status: designing (awaiting operator approval) — **handed off for a fresh session**
- Backend: `superpowers:brainstorming`, driven under `stack-control:design`

## Problem domain

The archive stores full-resolution JPEG page masters in plain git. Git cannot
delta-compress JPEGs, so every master sits at full size in history forever: the
`colony-cults-archive` `.git` reached **~1.9–2.1 GB for PB-P001 alone** (one of
~6 Port Breton sources), and pushes began timing out. This does not scale across
sources (PB-P002–P006) or future cases.

The masters are the preservation truth and must be kept — so the fix is to move
the **binary image bytes** to object storage while git keeps only the small,
diff-friendly research assets (census, provenance, OCR text, manifest).

## Solution space

### Chosen — Backblaze B2 (S3-compatible) object-store backend for the archive-writer

- **Backend**: the fetcher's archive-writer (`src/archive/`) gains an S3-compatible
  object-store backend. On write, image bytes go to **B2** (not the git working
  tree); the git-tracked provenance records the **object key + sha256 + size**.
- **Git keeps**: census (`data/census/`, public repo), per-asset provenance YAML,
  OCR `issue.txt`, and `MANIFEST.sha256`. **No image bytes in git.** (OCR text and
  translations are small — they stay in git.)
- **Object key scheme**: mirror the archive path, e.g.
  `archive/cases/port-breton/newspapers/la-nouvelle-france/<date>_<ark>/f001.jpg`.
- **Resumability**: skip an upload when the object already exists in B2 with the
  recorded sha256 (mirrors the current skip-if-recorded logic).
- **Reads/verify**: fetch/verify pull the object from B2 by key and check the
  recorded sha256.

### Verified B2 configuration (this session)

- Provider **Backblaze B2**, S3-compatible API.
- Bucket **`colony-cults`** (the app key is scoped to exactly this bucket).
- Endpoint **`https://s3.us-west-004.backblazeb2.com`**, region **`us-west-004`**.
- Credentials file (YAML): **`~/.config/backblaze/b2-credentials.txt`** with
  fields `keyID` / `keyName` / `applicationKey`. **Parsing gotcha:** the
  `applicationKey` line uses a **tab** after the colon — strip leading whitespace
  incl. tabs, not just spaces (a space-only strip sends a bad key → `bad_auth_token`).
- `keyID` = S3 Access Key ID; `applicationKey` = S3 Secret Access Key.
- Verified live: `b2_authorize_account` OK, and an S3 put/get/delete round-trip
  against the endpoint succeeded.
- **Security**: the `applicationKey` was exposed in this session's transcript —
  **rotate the B2 key** once the migration is done. Pass creds via env vars
  (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or `RCLONE_B2_*`), never argv.

### Migration state (already partly done this session)

- **All 945 PB-P001 JPEG masters are already uploaded to B2** at
  `b2:colony-cults/archive/...`, checksum-verified (`rclone check` → 0 differences,
  945 matching files).
- **Remaining migration**: strip the image blobs from the archive repo's **git
  history** (`git-filter-repo --path-glob '*.jpg' --invert-paths`) and **force-push**
  to reclaim the ~2 GB. **BLOCKED on coordination:** the translation session is
  actively committing to `colony-cults-archive`; a force-push would clobber it.
  Do the rewrite only when that session is quiesced, then have both sessions
  re-sync to the rewritten history. This subsumes backlog TASK-6.

### Rejected — Git LFS

Stays in git/GitHub via LFS pointers; simplest migration but recurring GitHub LFS
storage + bandwidth cost. Operator chose external object storage (cheaper at
scale, no egress on B2/R2).

### Rejected — don't store bytes (re-fetch from Gallica on demand)

Tiny repo, but it is no longer a preservation mirror (the whole point is insuring
against Gallica changing/removing items). Rejected.

## Decisions

1. **Backblaze B2** (S3-compatible), bucket `colony-cults`, `us-west-004`.
2. Archive-writer gains an **object-store backend**; image bytes → B2, git keeps
   census + provenance + OCR text + manifest only.
3. Provenance records **object key + sha256 + size**; object key mirrors the
   archive path.
4. **Resumability**: skip if the B2 object exists with the recorded sha256; `--force`
   re-uploads; `--verify` re-checks against B2.
5. Creds from `~/.config/backblaze/b2-credentials.txt` (YAML; tab-after-colon),
   passed via env vars, never argv. Config (bucket/endpoint/region) in a
   gitignored archive config or the tool config — not committed.
6. **No fallbacks / fail loud** on missing creds, upload failure, or checksum
   mismatch.
7. **One-time history purge** (strip `*.jpg` + force-push) completes the migration,
   coordinated with the translation session.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **S3 client choice** in TS: `@aws-sdk/client-s3` vs a lighter S3 signer. Lean
  `@aws-sdk/client-s3` (well-supported against B2's S3 endpoint).
- **Config surface**: where the tool reads bucket/endpoint/region + the creds path
  (a gitignored `.archive-store.yml` in the archive repo, or env). Keep secrets
  out of git.
- **Provenance representation**: extend the existing companion YAML with
  `object_store: { provider, bucket, key, endpoint }` + keep `sha256`/`size`, vs a
  separate object manifest. Lean: extend the YAML.
- **Cleanup pass**: the ~5 straggler PB-P001 issues (sleep-interrupted) should be
  fetched via the new backend (straight to B2), not git.
- **Local cache**: whether to keep a local working copy of images for OCR/dry-run,
  or stream from B2. OCR currently reads local `f###.jpg`; with images in B2 the
  OCR/verify paths must fetch from B2 first (or operate at fetch time before upload).
- **Migration coordination**: exact sequence for the history rewrite + both-session
  re-sync once translation is quiesced.

## Provenance

- Origin: interactive session, 2026-07-08, driven under `stack-control:design`.
- Decisions + the B2 config were made/verified live this session (auth, S3
  round-trip, 945-master upload + `rclone check`).
- Depends on the shipped `impl:feature/gallica-fetcher` (the archive-writer it
  extends) and relates to the parallel `impl:feature/source-translation`.
- Handoff target: `/stack-control:define`.
