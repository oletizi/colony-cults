# Contract: `bib acquire` dispatch + inventory for Papers Past

No new CLI verb — Papers Past plugs into the existing `bib acquire` member path.

## `bib acquire` dispatch

- `buildPapersPastAdapterForMember(member, ...)` (new, mirroring `src/cli/bib-acquire-museum.ts`'s `buildMuseumAdapterForMember`): loads the member, selects its record, and constructs `new PapersPastAdapter({ browserSession: <spec-014 real BrowserSession>, byteFetch: new HttpClient(), objectStore: new S3ObjectStore(resolveObjectStoreConfig()), now })` **only when** the selected copy's identifier type is `papers-past`; returns `undefined` otherwise (so a non-papers-past acquire pays no browser/B2 cost).
- Wired into `runAcquireCli` (`src/cli/bib-sourcegroup-acquire.ts`) alongside the museum/IA builders; `runAcquire` registers it in the adapter registry so `registry.selectForRecord(record)` dispatches a `papers-past` copy to it.
- Honors the shared `--dry-run` (no B2 write) and `--archive` selection. No IA-style `--approved-range` (single-item, not paginated).

| Outcome | Behaviour | Exit |
|---------|-----------|------|
| Acquire a public-domain papers-past member | page-masters + ocr-text mirrored to B2; assets + provenance recorded | 0 |
| `--dry-run` | read-only validation; 0 object-store writes, 0 record mutation | 0 |
| Record not assessed public-domain | fail-loud refusal, 0 side effects (fail-closed gate) | non-zero |
| Not an article / missing id / WAF-gated image | fail-loud (never fabricate, never mirror a challenge) | non-zero |

## `bib inventory` allowlist

`papers-past` is added to the repository allowlist / enumeration `bib inventory` surfaces, so a papers-past member is a recognized, inventoriable repository (parity with gallica/museum/internet-archive).
