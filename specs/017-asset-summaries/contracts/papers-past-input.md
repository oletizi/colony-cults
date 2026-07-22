# Contract: source-aware input resolution + Papers Past adapter

Extends the input layer (originally `selectSummaryInput(issueDir)`) to be **source-aware**
(FR-018) and to read the Papers Past `ocr-text` asset (FR-019/020), and fixes the
untranslated-French defect (FR-023 / AUDIT-17).

## Signature change

`selectSummaryInput` MUST receive the source's identity/language, not just a path. Shape (illustrative):

```ts
export interface SummaryInputRequest {
  readonly issueDir: string;
  readonly source: LoadedSource;   // the SSOT record — carries language + repository records
  readonly archiveRoot: string;
}
export async function selectSummaryInput(req: SummaryInputRequest): Promise<SelectedSummaryInput>;
```

`SelectedSummaryInput` gains an `origin` per layer so provenance can attribute it honestly:

```ts
export interface SelectedInputLayer {
  readonly path: string;           // relative to archiveRoot (Papers Past) or issueDir (Gallica)
  readonly sha256: string;
  readonly origin: 'project-ocr' | 'project-translation' | 'papers-past-ocr';
  readonly sourceRepresentation?: string;  // e.g. 'papers-past-text-tab' for Papers Past
}
```

## Routing (by source family)

1. **Papers Past** (`isPapersPastSource(source)`, `src/browser/load/papers-past.ts`):
   - Resolve the `ocr-text` asset via `papersPastOcrAsset(source)` → `{ objectStoreKey, checksum }`.
   - Ensure the `.txt` is local: `path.join(archiveRoot, objectStoreKey)`. If absent, **pre-fetch
     from B2/CDN reusing the shipped fetch** the browser snapshot uses; if it cannot be fetched,
     **fail loud** naming the asset (FR-020). Respect Constitution XII on any network access.
   - Read the text; layer `origin: 'papers-past-ocr'`, `sourceRepresentation: 'papers-past-text-tab'`.
   - **English-only** — no translation layer.
2. **Gallica French source** (has `issue.txt` = French OCR; source language French):
   - If `issue.en.txt` present → layers = French OCR (`project-ocr`) + English translation
     (`project-translation`).
   - If `issue.en.txt` **absent** → **fail loud** "translation pending — cannot summarize a French
     source without its English translation" (FR-023). Do NOT treat French OCR as English-native.
3. **Gallica English-native source** (language known English): English OCR (`project-ocr`).
4. **None usable / empty**: fail loud (unchanged; empty/whitespace still rejected).

## Provenance (FR-021)

`buildSummaryProvenance` records the `origin` of each input layer. A Papers Past summary's
`input_layers` are attributed to Papers Past (source-downloaded); Gallica layers are attributed to
the project (our OCR / our translation). The interpretation-not-evidence label (FR-006) is unchanged.
Papers Past summary artifacts still write only via `storeAsset` (Constitution XV).

## Reuse, not duplication

The Papers Past layout knowledge lives ONCE in `src/browser/load/papers-past.ts`
(`isPapersPastSource`, `papersPastOcrAsset`, and the OCR-`.txt` read). The summarizer imports and
reuses those; it does not re-encode the `archive/papers-past/<id>/<sha>.txt` layout.

## Tests

- Papers Past source → reads `ocr-text` asset, generates both summaries, provenance attributes the
  layer to Papers Past, no translation layer.
- Papers Past `.txt` missing/unfetchable → fail loud naming the asset.
- French Gallica source, translation absent → fail loud "translation pending" (AUDIT-17), NOT an
  English-native summary.
- Existing Gallica French (OCR+translation) and monograph paths unchanged.
