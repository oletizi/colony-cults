# Contract: SSOT `publications[]` + `rights` + manifest file

**Feature**: `specs/008-edition-publishing`

The on-disk shape publishing reads and writes. Loadable by `@/bibliography/load.ts` and
byte-deterministically emitted by `@/bibliography/migrate-serialize.ts`.

## 1. `Source.rights` (in `bibliography/sources/<id>.yml`)

```yaml
rights:
  status: public-domain          # closed vocab (SourceRightsStatus); only affirmative-distributable clears the gate
  basis: "1881 imprint; French public domain"   # required justification, recorded as rightsBasis on publish
  determinedAt: "2026-07-12"     # optional ISO date
```

- The loader MUST accept `rights` (add `'rights'` to `SOURCE_KEYS`) and validate `status`
  against the closed vocab in `@/bibliography/vocab`.
- Fail-closed: absent `rights`, or a `status` not in the affirmative-distributable set, blocks
  publishing (FR-002). The free-text `notes` "Public domain: likely" is NOT consulted.

## 2. `Source.publications[]` (in `bibliography/sources/<id>.yml`)

```yaml
publications:
  - variant: english-only
    publishedAt: "2026-07-12"
    snapshot: "3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10"
    snapshotShort: "3b8b1fd6"
    cdnBase: "https://colony-cults-cdn.oletizi.workers.dev"
    keyScheme: versioned            # versioned | legacy-flat
    rightsBasis: "1881 imprint; French public domain"
    machineAssist:                  # required for translated (english-only); omit for pure facsimile
      engine: "claude"
      date: "2026-07-12"
    manifest:
      manifestPath: "bibliography/publications/PB-P001-english-only-3b8b1fd6.yml"
      issueCount: 71
```

- Add `'publications'` to `SOURCE_KEYS`; parse via a per-element validator mirroring the
  `repositoryRecords` path (`load.ts:200-223`).
- Emit via `serializeSource` in fixed key order (mirroring `orderedRecord`), omitting absent
  optionals, so re-serialize is byte-identical (idempotency).
- `(variant, snapshotShort)` is unique within `publications[]` (validated). A re-publish of the
  same version does not add a second entry (FR-004); a changed rebuild adds a NEW entry with a
  new `snapshotShort` (FR-009).

## 3. Manifest file (`bibliography/publications/<sourceId>-<variant>-<snapshotShort>.yml`)

```yaml
sourceId: PB-P001
variant: english-only
snapshot: "3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10"
issues:
  - issueId: "1879-07-15_bpt6k5605235w"
    key: "editions/english-only/PB-P001/1879-07-15_bpt6k5605235w__3b8b1fd6.pdf"
    url: "https://colony-cults-cdn.oletizi.workers.dev/editions/english-only/PB-P001/1879-07-15_bpt6k5605235w__3b8b1fd6.pdf"
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    pages: 40
  # … sorted by issueId
```

For the reconciled 72 (legacy-flat): filename `PB-P001-english-only-legacy.yml`; `snapshot`
omitted or `legacy`; keys `editions/english-only/PB-P001/<issueId>.pdf` (no `__short`).

## Invariants (validated)

- Every `sha256` is 64 lowercase hex chars.
- `url === cdnBase + '/' + key` for every issue (URL is derived, never free-typed).
- `manifest.issueCount === issues.length`.
- Manifest file at `manifestPath` exists for every `publications[]` entry.
- Manifest emission is deterministic (fixed key order, issues sorted by `issueId`) — a re-run
  over unchanged inputs rewrites byte-identical content (no churn, SC-004).
- Versioned and legacy-flat schemes coexist on the same source by design (FR-013).
