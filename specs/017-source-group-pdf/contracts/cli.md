# Contract: pdf:build selectors + materializer (source-group PDF)

The feature extends the existing `pdf:build` CLI (contracts from spec 007/014)
and adds one internal materializer contract. No new public flags are required
beyond the existing `--out`, `--provider`, `--archive-root`, `--no-french`.

## CLI selector contract

| Selector | Meaning | Behavior |
|----------|---------|----------|
| `<memberId>` (e.g. `PB-P061`) | one source-group member | registers the member layout, materializes its `issue.txt`, renders one per-member facsimile PDF (stacked-segment verso │ English OCR recto). |
| `<groupId>` (e.g. `PB-P060`) | a source-group | detects `kind: source-group`; enumerates members, orders chronologically, emits ONE combined group-edition PDF. Never fetched as an object. |
| `--all` | whole corpus | discovers standalone sources AND buildable members (member layouts registered before the discoverability filter); record-and-continue. |

- A `<groupId>` with zero acquired members → fail loud naming the empty group.
- English members render english-only automatically (or via `--no-french`); the
  reading language is resolved per source.
- Guarantees inherited: G-1 (one PDF per item), G-2 (unknown id fails loud), G-3
  (internal-first, writes only under `--out`), G-4 (attributable, record-and-continue
  batch), G-6 (Typst preflight).

## Materializer contract (`materializeIssueText`)

Input: a member `Source` (with its `repositoryRecords[].assets`), the archive root,
and an object-store reader.

Behavior:
1. Resolve the single `role: ocr-text` asset (fail loud if absent or ambiguous).
2. Fetch its bytes from the object store; verify the sha256 against the asset record.
3. Write `issue.txt` (the OCR text) and `issue.txt.yml` (provenance: object-store
   key, sha256, `source_representation`) into the member's archive dir.
4. Idempotent: identical existing content → no-op; conflicting content → fail loud
   (never clobber).
5. Never runs for a source that already has an inline `issue.txt`.

Output: the path to the materialized `issue.txt` (so the reader resolves it).

Errors (all fail loud, id-naming): no ocr-text asset; checksum mismatch;
object-store fetch failure; conflicting existing issue.txt.

## Reader expectation (unchanged)

After materialization the member's archive dir matches the shape the archive-direct
reader already handles for an English monograph (PB-P057): flat page-image folios +
`issue.txt`. The reader is NOT modified.
