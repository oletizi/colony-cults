# Contract: runAcquire completion + completeness verifier

## `runAcquire` (extended — `src/sourcegroup/acquire.ts`)

After the existing dispatch → `adapter.acquire` → persist-assets → write-companions block, and BEFORE returning the `AcquireResult`:

1. **Reconcile tail (not on `--dry-run`).** Run the existing `reconcile` (idempotent, `ObjectStore`-heads-only) for the selected record to advance `status`. Reuse the object-store config `runAcquire` already resolved for companions. This is inseparable from the acquire — not a separate command.
2. **Completeness verification (not on `--dry-run`).** Call `verifyRecordComplete(record, { objectStore, reconciled })`. It throws a descriptive Error (fail-loud) if the record is incomplete for its repository kind; `runAcquire` propagates it (non-zero exit at the CLI), naming what is missing.
3. **Return success only when complete.** `runAcquire` returns its `AcquireResult` only after the verifier passes. It MUST NOT report a successful acquire with an incomplete/unadvanced record.
4. **`--dry-run`.** Steps 1–2 are skipped (the adapter mirrored nothing; there is nothing to complete or verify).

Invariants:
- No source re-fetch in the tail (reconcile is heads-only).
- Idempotent: a re-run over an already-complete record advances nothing, writes nothing, and still passes verification (0 duplicate object-store writes).
- Source-agnostic: identical for gallica / new-italy-museum / internet-archive / papers-past; the per-repository branching lives in the verifier, keyed on the record's asset shape, never on adapter identity.

## `verifyRecordComplete(record, ctx)` (new — `src/sourcegroup/acquire-completeness.ts`)

```
verifyRecordComplete(
  record: RepositoryRecord,
  ctx: { objectStore: ObjectStore; reconciled: { status: string; advanced: boolean } },
): Promise<void>   // resolves on complete; THROWS a descriptive Error on incomplete
```

- **B2-direct** (record has object-store-keyed masters): every recorded `page-master`/`primary` asset's `objectStoreKey` MUST HEAD present with `sha256 === asset.checksum`; `reconciled.status` MUST be `archived`. Else throw naming the specific missing/mismatched key or the unadvanced status.
- **Per-page-provenance** (`assets: []`, Gallica): pass when `reconciled.status` is `collected` (archive-provenance path); do NOT require object-store assets.
- **metadataSnapshot**: when the adapter emits one (record has/should have `metadataSnapshot`), require it present; otherwise skip (best-effort per-adapter).
- Pure over injected inputs; no network beyond the injected `ObjectStore.head`; no host mutation.

## CLI (`bib acquire`) — observable behavior

| Outcome | Behaviour | Exit |
|---------|-----------|------|
| Acquire completes + record complete | status advanced (archived/collected), assets recorded, verification passes | 0 |
| Acquire mirrored bytes but record cannot be completed | fail loud, names the incompleteness; NOT reported as success | non-zero |
| Re-run after an incomplete prior acquire | completes the record idempotently, 0 duplicate object-store writes | 0 |
| `--dry-run` | mirrors nothing; tail + verification skipped | 0 |
