# Papers Past source-OCR asset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the Papers Past source OCR (`#text-tab`) as a first-class `ocr-text` `AcquiredAsset` in the same acquire operation as the page-masters, with provenance recording the source representation + encoding.

**Architecture:** The adapter already parses `parsed.ocrText`. Add an `ocr-text` asset role; when OCR is present, weld one text asset (`archive/papers-past/<id>/<sha256>.txt`) into the existing verify-all-then-commit flow (Principle XV, atomic with the GIFs). Provenance records `source_representation: papers-past-text-tab` and `charset=utf-8` (via the media type). Capture-only; downstream pipeline wiring is out of scope.

**Tech Stack:** TypeScript (ESM, `@/` alias), vitest (hermetic fakes), node-html-parser. Design: `docs/superpowers/specs/2026-07-21-papers-past-ocr-asset-design.md`.

## Global Constraints

- `@/` imports; no `any`/`as Type`/`@ts-ignore`; fail-loud, no fallbacks outside tests.
- **Faithful OCR:** store the `#text-tab` text as-is — do NOT normalize whitespace, repair spelling, normalize Unicode, or trim layout.
- **Atomic (Principle XV):** the OCR asset joins the SAME verify-all-then-commit as the page-masters — a failure leaves ZERO orphans; the SSOT `assets[]` entry welds in the same operation.
- **OCR non-mandatory:** absent OCR is NOT an acquisition failure — acquire the page-masters, emit no `ocr-text` asset, no throw.
- **Additive provenance:** the new `source_representation` key is optional and MUST NOT perturb byte-identical re-serialization of records that lack it (the `engine` precedent).
- Commit each task when green; run commands with `npx vitest`/`npm run typecheck`; no `sed`; write commit messages via a file + `git commit -F` (no `#` in heredocs).

---

### Task 1: Model additions — `ocr-text` role + provenance `source_representation`

**Files:**
- Modify: `src/model/acquired-asset.ts`
- Modify: `src/archive/provenance.ts`
- Test: `tests/unit/archive/provenance-ocr-representation.test.ts` (new); extend an existing acquired-asset/loader test

**Interfaces:**
- Produces: `'ocr-text'` in `ACQUIRED_ASSET_ROLES`; `AcquiredAsset.sourceRepresentation?: string`; `ProvenanceFields.source_representation?: string` (serialized/parsed).

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/archive/provenance-ocr-representation.test.ts
import { describe, expect, it } from 'vitest';
import { serializeProvenance, parseProvenance } from '@/archive/provenance';
import type { ProvenanceFields } from '@/archive/provenance';
import { isAcquiredAssetRole } from '@/model/acquired-asset';

function baseFields(): ProvenanceFields {
  return {
    id: 'PB-P061', title: 'X', type: 'ocr-text', case: 'port-breton',
    language: 'English', source_archive: 'Papers Past', catalog_url: 'https://x',
    original_url: 'https://x', rights_status: 'public-domain', retrieved: '2026-07-21T00:00:00.000Z',
    local_path: 'archive/papers-past/hns.../a.txt', sha256: 'a'.repeat(64),
    format: 'text/plain; charset=utf-8', ocr_status: 'none', size: 12,
    object_store: null, rights_raw: '', notes: null,
  };
}

describe('ocr-text role + source_representation provenance', () => {
  it('accepts ocr-text as a known role', () => {
    expect(isAcquiredAssetRole('ocr-text')).toBe(true);
  });

  it('emits source_representation when present and round-trips', () => {
    const out = serializeProvenance({ ...baseFields(), source_representation: 'papers-past-text-tab' });
    expect(out).toContain('source_representation: papers-past-text-tab');
    expect(parseProvenance(out).source_representation).toBe('papers-past-text-tab');
  });

  it('omits source_representation entirely when unset (byte-identical to no-key form)', () => {
    const out = serializeProvenance(baseFields());
    expect(out).not.toContain('source_representation');
  });
});
```

Note: confirm the exact exported serializer/parser names in `src/archive/provenance.ts` (e.g. `serializeProvenance`/`parseProvenance` vs `writeProvenance`/`readProvenance` + a pure serialize). Use the pure string serializer/parser the existing tests use; adjust imports to match.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/unit/archive/provenance-ocr-representation.test.ts`
Expected: FAIL (`ocr-text` not a role; `source_representation` not serialized).

- [ ] **Step 3: Add the role + asset field** (`src/model/acquired-asset.ts`)

Add `'ocr-text'` to the `ACQUIRED_ASSET_ROLES` tuple (after `'page-master'`), and add an optional field to the `AcquiredAsset` interface:

```typescript
  /**
   * The repository representation this asset was captured from, e.g.
   * `papers-past-text-tab` for the correctable-text OCR panel. Distinguishes
   * future alternative OCR sources (ALTO XML, downloadable text, corrected
   * editions). Optional/additive; absent on image masters.
   */
  sourceRepresentation?: string;
```

Update the `ACQUIRED_ASSET_ROLES` doc comment to mention `ocr-text` (one per-article OCR text from the repository).

- [ ] **Step 4: Add the provenance field** (`src/archive/provenance.ts`)

- Add to `ProvenanceFields` (near `engine`):

```typescript
  /**
   * The repository representation that produced this asset, e.g.
   * `papers-past-text-tab`. Additive OPTIONAL key: omitted when unset so
   * records without it re-serialize byte-identically.
   */
  source_representation?: string;
```

- Add `'source_representation'` to `KEY_ORDER` — place it alongside the other additive optional keys (after `'translation'`).
- In the per-key emit switch, add `source_representation` to the same optional-omit case as `engine`/`model`/`translation`:

```typescript
    case 'engine':
    case 'model':
    case 'translation':
    case 'source_representation': {
      return value === undefined ? undefined : emitField(key, value);
    }
```

- In the parser, add: `source_representation: scalars.get('source_representation') ?? undefined,` alongside `engine`/`model`/`translation`.

- [ ] **Step 5: Run tests + typecheck — expect PASS**

Run: `npx vitest run tests/unit/archive/provenance-ocr-representation.test.ts && npm run typecheck`
Expected: PASS. Then run the existing provenance suite to prove byte-identical re-serialization of records WITHOUT the key still holds: `npx vitest run tests/unit/archive` (adjust path). If a golden-file/round-trip test exists, it must stay green.

- [ ] **Step 6: Commit**

```
feat(model): add ocr-text asset role + source_representation provenance key

Additive: ocr-text role for repository OCR; ProvenanceFields.source_representation
(optional, omitted when unset -> byte-identical for non-OCR records).
```

---

### Task 2: OCR key/path helpers + faithful extraction

**Files:**
- Modify: `src/repository/papers-past/keys.ts`
- Modify: `src/repository/papers-past/parse.ts`
- Test: `src/repository/papers-past/parse.test.ts` (extend); a keys test if one exists (else add inline to parse/adapter test)

**Interfaces:**
- Produces: `objectKeyForOcr(articleId, sha256Hex): string` (`.txt`); `provenancePathForOcr(articleId, sha256Hex): string` (`.yml`); `extractOcrText` now faithful (no whitespace collapse).

- [ ] **Step 1: Write failing tests**

```typescript
// add to src/repository/papers-past/parse.test.ts (or a keys test)
import { objectKeyForOcr, provenancePathForOcr } from '@/repository/papers-past/keys';

it('objectKeyForOcr / provenancePathForOcr are deterministic .txt/.yml under the article dir', () => {
  const sha = 'a'.repeat(64);
  expect(objectKeyForOcr('HNS18840103.2.19.3', sha))
    .toBe(`archive/papers-past/hns18840103.2.19.3/${sha}.txt`);
  expect(provenancePathForOcr('HNS18840103.2.19.3', sha))
    .toBe(`archive/papers-past/hns18840103.2.19.3/${sha}.yml`);
});

it('extractOcrText preserves internal line structure (faithful, not whitespace-collapsed)', () => {
  // Two lines in the #text-tab panel must NOT collapse into one.
  const html = `<html><body><div id="text-tab">LINE ONE\n\nLINE TWO</div>
    <div id="image-tab"><img src="/imageserver/newspapers/QQ=="></div><h3>T</h3></body></html>`;
  // parseArticle requires image locators + title + rights; use the adapter fixture
  // instead if parseArticle's other required fields make a bare fixture awkward —
  // the key assertion is that the returned ocrText contains a newline, i.e. is not
  // collapsed to a single space.
  // (If asserting via parseArticle is impractical, assert extractOcrText directly
  // by exporting it for test, or via an existing multi-line fixture.)
});
```

If `extractOcrText` is not exported, either export it for the focused assertion, or assert faithfulness through `parseArticle` using a fixture whose `#text-tab` spans multiple lines and check `article.ocrText` contains a newline.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/repository/papers-past/parse.test.ts`
Expected: FAIL — `objectKeyForOcr` undefined; faithful assertion fails (current code collapses whitespace).

- [ ] **Step 3: Add key helpers** (`src/repository/papers-past/keys.ts`)

```typescript
/** The deterministic object-store key for the source-OCR text asset (`.txt`). */
export function objectKeyForOcr(articleId: string, sha256Hex: string): string {
  return `${KEY_PREFIX}/${sanitizeArticleId(articleId)}/${sha256Hex}.txt`;
}

/** The companion provenance path for the source-OCR text asset (`.yml`). */
export function provenancePathForOcr(articleId: string, sha256Hex: string): string {
  return `${KEY_PREFIX}/${sanitizeArticleId(articleId)}/${sha256Hex}.yml`;
}
```

- [ ] **Step 4: Make `extractOcrText` faithful** (`src/repository/papers-past/parse.ts`)

Replace the whitespace-collapsing extraction:

```typescript
function extractOcrText(root: ReturnType<typeof parse>): string | undefined {
  const container = root.querySelector(OCR_SELECTOR);
  if (!container) return undefined;
  // Faithful: preserve the panel's line structure; trim only outer whitespace.
  // structuredText inserts newlines at block boundaries (node-html-parser),
  // preserving the correctable-text layout rather than collapsing it.
  const text = container.structuredText.trim();
  return text.length > 0 ? text : undefined;
}
```

If `structuredText` is unavailable/does not preserve lines in this version, fall back to `container.text` WITHOUT the `.replace(/\s+/g, ' ')` collapse (still an improvement); the test asserts a newline survives — pick whichever passes it.

Update the `extractOcrText` doc comment: it is now the source of a stored asset, captured faithfully.

- [ ] **Step 5: Reconcile `parse.test.ts:52`**

The existing assertion `expect(article.ocrText).toContain('found guilty and sentenced to four years')` must still pass. Faithful extraction changes surrounding whitespace, not this contiguous phrase (it is within one line in the fixture) — confirm it stays green; if the phrase spanned a line break, adjust the expected substring to the faithful form.

- [ ] **Step 6: Run — expect PASS + typecheck**

Run: `npx vitest run src/repository/papers-past/parse.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```
feat(papers-past): ocr key/path helpers + faithful #text-tab extraction

objectKeyForOcr/.txt + provenancePathForOcr/.yml; extractOcrText no longer
collapses whitespace (the text is now a stored asset -> preserve it faithfully).
```

---

### Task 3: Adapter captures the OCR asset (atomic, Principle XV)

**Files:**
- Modify: `src/repository/papers-past/adapter.ts`
- Test: `tests/integration/repository/papers-past/acquire.test.ts` (extend, hermetic fakes)

**Interfaces:**
- Consumes: `parsed.ocrText`, `objectKeyForOcr`, `provenancePathForOcr`, the `ocr-text` role.
- Produces: `acquire()` returns page-masters + (when OCR present) one `ocr-text` asset.

- [ ] **Step 1: Write failing tests** (extend `acquire.test.ts`, injected `ObjectStore`/`BrowserSession` fakes)

Assert on a public-domain acquire with OCR present:

```typescript
it('captures the source OCR as an ocr-text asset alongside the page-masters', async () => {
  // ... existing PD-acquire fake setup (fixture article HTML with #text-tab OCR) ...
  const result = await adapter.acquire(record, ctx);
  const ocr = result.assets.filter((a) => a.role === 'ocr-text');
  expect(ocr).toHaveLength(1);
  expect(ocr[0].mediaType).toBe('text/plain; charset=utf-8');
  expect(ocr[0].sourceRepresentation).toBe('papers-past-text-tab');
  expect(ocr[0].objectStoreKey).toMatch(/^archive\/papers-past\/.+\/[0-9a-f]{64}\.txt$/);
  // the put text equals the parsed OCR, sha256 matches, key is checksum-addressed
  const put = fakeStore.puts.find((p) => p.key === ocr[0].objectStoreKey);
  expect(put).toBeDefined();
  expect(new TextDecoder().decode(put.bytes)).toContain('found guilty'); // faithful OCR bytes
  expect(result.assets.filter((a) => a.role === 'page-master').length).toBeGreaterThan(0);
});

it('is idempotent on the ocr-text object (0 duplicate put on re-run)', async () => { /* head returns matching sha -> no second put */ });
it('dry-run puts no ocr-text object and returns empty assets', async () => { /* ctx.dryRun -> assets [] */ });
it('OCR absent -> page-masters only, no ocr-text asset, no throw', async () => {
  // fixture #text-tab empty/absent -> parsed.ocrText undefined
  const result = await adapter.acquire(recordNoOcr, ctx);
  expect(result.assets.some((a) => a.role === 'ocr-text')).toBe(false);
  expect(result.assets.some((a) => a.role === 'page-master')).toBe(true);
});
```

Match the existing test's fake shapes (how `puts` are recorded, how the article fixture is scripted). Reuse the existing PD fixture; add an OCR-absent fixture variant.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/integration/repository/papers-past/acquire.test.ts`
Expected: FAIL — no `ocr-text` asset produced.

- [ ] **Step 3: Implement OCR capture in `acquire()`**

In STEP 4/5, after the page-master `verified` segments are built and BEFORE/within the commit, add the OCR asset to the same verify-then-commit discipline. Concretely, after `pageMasters` are committed (they already are atomic) and using the same `objectStore`:

```typescript
import { objectKeyForOcr, provenancePathForOcr } from '@/repository/papers-past/keys';
// ... inside acquire(), after building pageMasters (STEP 4 PHASE B), before STEP 5 return:

const assets: AcquiredAsset[] = [...pageMasters];
if (typeof parsed.ocrText === 'string' && parsed.ocrText.length > 0) {
  const ocrBytes = new TextEncoder().encode(parsed.ocrText);
  const ocrChecksum = sha256Hex(ocrBytes);           // reuse the same sha256 helper the segments use
  const ocrKey = objectKeyForOcr(parsed.articleId, ocrChecksum);
  const head = await objectStore.head(ocrKey);        // idempotent head-then-put
  if (!(head.exists && head.sha256 === ocrChecksum)) {
    await objectStore.put(ocrKey, ocrBytes, { sha256: ocrChecksum, contentType: 'text/plain; charset=utf-8' });
  }
  assets.push({
    sourceUrl: pageUrl,                                // the article page the OCR was read from
    mediaType: 'text/plain; charset=utf-8',
    objectStoreKey: ocrKey,
    checksum: ocrChecksum,
    byteLength: ocrBytes.length,
    provenancePath: provenancePathForOcr(parsed.articleId, ocrChecksum),
    role: 'ocr-text',
    sequence: 0,
    sourceRepresentation: 'papers-past-text-tab',
  });
}
// STEP 5 return: assets: assets  (was: assets: pageMasters)
```

Notes for the implementer:
- Use the SAME `sha256Hex` helper the segment loop already uses (find it in the adapter/imports — do not introduce a second hashing path).
- The OCR has no separate PHASE A byte-fetch (the text is already in `parsed.ocrText`); its "verify" is the checksum. Keep it AFTER the page-masters' all-or-nothing PHASE A so a page-master verify failure still aborts before any OCR write. This preserves "zero orphans."
- `dryRun` already returns early with `assets: []` — the OCR block is never reached under dry-run. Leave that path untouched.
- Update the STEP-5 doc comment: "return the page-masters + the source-OCR asset (when present) + a raw metadata snapshot."

- [ ] **Step 4: Run — expect PASS + typecheck + full papers-past suite**

Run: `npx vitest run tests/integration/repository/papers-past tests/unit/repository/papers-past && npm run typecheck`
Expected: PASS, 0 network calls.

- [ ] **Step 5: Commit**

```
feat(papers-past): capture source OCR as an ocr-text asset (atomic, Principle XV)

When #text-tab OCR is present, weld one ocr-text .txt asset into the same commit
as the page-masters (checksum-addressed, idempotent). Absent OCR is non-fatal.
```

---

### Task 4: Provenance companion for the ocr-text asset

**Files:**
- Modify: `src/archive/write-record-companions.ts`
- Test: `tests/unit/archive/...` companion test (extend the existing writeRecordCompanions test)

**Interfaces:**
- Consumes: an `AcquiredAsset` with `role: 'ocr-text'`, `sourceRepresentation`, `mediaType: 'text/plain; charset=utf-8'`.
- Produces: a companion `.yml` at the asset's `provenancePath` with `type: ocr-text`, `format: text/plain; charset=utf-8`, `source_representation: papers-past-text-tab`.

- [ ] **Step 1: Write failing test**

```typescript
it('writes an ocr-text companion with source_representation + charset', async () => {
  // record with one ocr-text asset (provenancePath archive/papers-past/<id>/<sha>.yml,
  // objectStoreKey .../<sha>.txt, mediaType text/plain; charset=utf-8,
  // sourceRepresentation papers-past-text-tab)
  const written = await writeRecordCompanions({ source, record, archiveRoot, objectStore, now });
  const yml = readFileSync(written.find((p) => p.endsWith(`${sha}.yml`))!, 'utf-8');
  expect(yml).toContain('type: ocr-text');
  expect(yml).toContain('format: text/plain; charset=utf-8');
  expect(yml).toContain('source_representation: papers-past-text-tab');
});
```

Follow the existing companion test's setup (archiveRoot tmp dir, fake object store coords).

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/unit/archive` (the companion test path)
Expected: FAIL — `type` is `page-image` (not `ocr-text`); no `source_representation`.

- [ ] **Step 3: Implement**

In `src/archive/write-record-companions.ts`:

- `companionType`: add an `ocr-text` case (by role, most precise):

```typescript
function companionType(asset: AcquiredAsset): string {
  if (asset.role === 'ocr-text') return 'ocr-text';
  if (asset.mediaType === 'application/pdf') return 'source-document';
  return 'page-image';
}
```

- In the `ProvenanceFields` object built per asset, add `source_representation` from the asset (additive; undefined for non-OCR assets so their serialization is unchanged):

```typescript
      format: asset.mediaType,
      ocr_status: 'none',
      size: asset.byteLength,
      object_store: store,
      source_representation: asset.sourceRepresentation,
      rights_raw: rightsRaw,
      notes: null,
```

`placement()` already routes a non-`page-master` asset to its own `provenancePath` + object key (the else-branch), so the OCR companion lands at `archive/papers-past/<id>/<sha>.yml` with `local_path` = the `.txt` key — no placement change needed. `format` carries the `charset=utf-8`.

- [ ] **Step 4: Run — expect PASS + typecheck + full suite**

Run: `npx vitest run tests/unit/archive && npm run typecheck`
Expected: PASS. Then `npx vitest run` — the only failures are the 3 pre-existing `CORPUS_ARCHIVE_PATH` env ones.

- [ ] **Step 5: Commit**

```
feat(archive): ocr-text companion records source_representation + charset

companionType('ocr-text'); provenance carries source_representation
(papers-past-text-tab) and format text/plain; charset=utf-8. Non-OCR companions
unchanged (source_representation omitted -> byte-identical).
```

---

## Self-Review

**Spec coverage** (design §1–5): §1 role → Task 1; §2 adapter capture → Task 3; §3 provenance refinements (source_representation + charset) → Task 1 (field) + Task 3 (asset) + Task 4 (companion); §4 fidelity (faithful) → Task 2, absent-OCR non-fatal → Task 3, rights gate reused (unchanged); §5 tests → each task TDD.

**Placeholder scan:** the two "confirm exact exported name" / "if structuredText unavailable" notes are deliberate implementer-verification points with a concrete default given, not TODOs — every step has runnable code + expected output.

**Type consistency:** `sourceRepresentation` (AcquiredAsset) ↔ `source_representation` (ProvenanceFields, snake_case) mapping is explicit in Task 4. `objectKeyForOcr`/`provenancePathForOcr` names match across Task 2 (def) and Task 3 (use). `'ocr-text'` role string identical in model, adapter, companionType.

**Deliberate behavior change to flag for review:** `extractOcrText` stops whitespace-collapsing (Task 2) — this changes the `parsed.ocrText` value shape; Task 2 Step 5 reconciles the one existing assertion that reads it.

## Execution Handoff

(Filled after user review — subagent-driven TDD recommended, per the design's governance.)
