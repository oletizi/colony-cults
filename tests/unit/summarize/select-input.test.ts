import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { selectSummaryInput, type SummaryInputRequest } from '@/summarize/select-input';
import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import type { ObjectStore } from '@/archive/object-store';
import type { LoadedSource } from '@/bibliography/load';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { AcquiredAsset } from '@/model/acquired-asset';
import { writeMemberFixture, type WriteMemberFixtureResult } from '../pdf/member-fixture';

/** Lowercase-hex SHA-256, computed independently of the implementation under test. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Minimal source-aware Gallica {@link LoadedSource} fixture (FR-018).
 * `language` drives the French/English routing; it carries NO repository
 * records, so it is never a source-group member -- its reading text is always
 * the on-disk `issue.txt`/`issue.en.txt`. A MEMBER (Papers Past) whose reading
 * text is a detached `ocr-text` asset is exercised separately via
 * {@link memberLoadedSource} + `writeMemberFixture`.
 */
function loadedSource(opts: { language?: string } = {}): LoadedSource {
  const source: Source = {
    sourceId: 'PB-P001',
    titles: [{ text: 'Test Source', role: 'canonical' }],
    kind: 'periodical',
    identifiers: [],
    ...(opts.language !== undefined ? { language: opts.language } : {}),
  };
  return { source, records: [], identifierLeaks: [] };
}

/** A member {@link LoadedSource} carrying a fixture's detached `ocr-text` asset. */
function memberLoadedSource(fixture: WriteMemberFixtureResult): LoadedSource {
  const record: AuthoredRepositoryRecord = {
    sourceArchive: fixture.repositoryRecord.sourceArchive,
    status: fixture.repositoryRecord.status,
    catalogUrl: fixture.repositoryRecord.catalogUrl,
    identifiers: fixture.repositoryRecord.identifiers,
    assets: fixture.repositoryRecord.assets,
  };
  return { source: fixture.memberSource, records: [record], identifierLeaks: [] };
}

/** Minimal valid provenance record, overridable per test (mirrors other unit-test fixtures). */
function baseProvenance(overrides: Partial<ProvenanceFields> = {}): ProvenanceFields {
  return {
    id: 'PB-P001',
    title: 'La Nouvelle France',
    type: 'ocr-text',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k5603637g',
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-08T00:00:00.000Z',
    local_path: 'archive/cases/port-breton/newspapers/la-nouvelle-france/1885-01-01_ark/issue.txt',
    sha256: 'a'.repeat(64),
    size: 42,
    format: 'text/plain',
    ocr_status: 'searchable',
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
    ...overrides,
  };
}

describe('selectSummaryInput', () => {
  let issueDir: string;
  let archiveRoot: string;

  /** Build a source-aware request against the current temp dirs. */
  function req(source: LoadedSource): SummaryInputRequest {
    return { issueDir, source, archiveRoot };
  }

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-select-input-arch-'));
    issueDir = mkdtempSync(path.join(tmpdir(), 'cc-select-input-'));
  });

  afterEach(() => {
    rmSync(issueDir, { recursive: true, force: true });
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('selects issue.txt only (project-ocr) for an English-native source with no translation', async () => {
    const text = 'This is an English-language OCR of this issue.';
    writeFileSync(path.join(issueDir, 'issue.txt'), text, 'utf-8');

    const result = await selectSummaryInput(req(loadedSource({ language: 'English' })));

    expect(result.layers).toEqual([
      { path: 'issue.txt', sha256: sha256(text), origin: 'project-ocr' },
    ]);
    expect(result.text).toContain(text);
  });

  it('selects issue.txt only for an unknown-language source with no translation (e.g. monograph)', async () => {
    const text = 'Some OCR text of a source whose SSOT omits language.';
    writeFileSync(path.join(issueDir, 'issue.txt'), text, 'utf-8');

    const result = await selectSummaryInput(req(loadedSource()));

    expect(result.layers).toEqual([
      { path: 'issue.txt', sha256: sha256(text), origin: 'project-ocr' },
    ]);
  });

  it('selects BOTH issue.txt (project-ocr) and issue.en.txt (project-translation) when both exist', async () => {
    const frenchText = 'Le journal rapporte une reunion publique.';
    const englishText = 'The newspaper reports a public meeting.';
    writeFileSync(path.join(issueDir, 'issue.txt'), frenchText, 'utf-8');
    writeFileSync(path.join(issueDir, 'issue.en.txt'), englishText, 'utf-8');

    const result = await selectSummaryInput(req(loadedSource({ language: 'French' })));

    expect(result.layers).toEqual([
      { path: 'issue.txt', sha256: sha256(frenchText), origin: 'project-ocr' },
      { path: 'issue.en.txt', sha256: sha256(englishText), origin: 'project-translation' },
    ]);
    expect(result.text).toContain(frenchText);
    expect(result.text).toContain(englishText);
    expect(result.text.indexOf(frenchText)).toBeLessThan(result.text.indexOf(englishText));
  });

  it('FAILS LOUD ("translation pending") for a KNOWN-FRENCH source whose issue.en.txt is absent (FR-023 / AUDIT-17)', async () => {
    // The exact silent-wrong-input defect: only French OCR is present, so the
    // old present-files logic would summarize it as if English-native.
    writeFileSync(
      path.join(issueDir, 'issue.txt'),
      'Ceci est le texte francais original de ce numero.',
      'utf-8',
    );

    await expect(
      selectSummaryInput(req(loadedSource({ language: 'French' }))),
    ).rejects.toThrow(/translation pending/);
    // It must NOT have produced an English-native single-layer result.
    await expect(
      selectSummaryInput(req(loadedSource({ language: 'French' }))),
    ).rejects.toThrow(/French/);
  });

  it('fails loud, naming the missing text, when neither issue.txt nor issue.en.txt exists', async () => {
    await expect(selectSummaryInput(req(loadedSource()))).rejects.toThrow(/issue\.txt/);
    await expect(selectSummaryInput(req(loadedSource()))).rejects.toThrow(/issue\.en\.txt/);
  });

  it('surfaces an inputQuality note when the OCR companion records a low quality tier', async () => {
    const text = 'Texte OCR de mauvaise qualite.';
    const filePath = path.join(issueDir, 'issue.txt');
    writeFileSync(filePath, text, 'utf-8');
    await writeProvenance(
      companionYamlPath(filePath),
      baseProvenance({
        ocr_quality: {
          method: 'aspell-realword-ratio-v1',
          language: 'fr',
          ratio: 0.31,
          tier: 'low',
        },
      }),
    );

    const result = await selectSummaryInput(req(loadedSource({ language: 'English' })));

    expect(result.inputQuality).toBeDefined();
    expect(result.inputQuality?.tier).toBe('low');
    expect(result.inputQuality?.note.length).toBeGreaterThan(0);
  });

  it('does not surface an inputQuality note when OCR quality is not low (or absent)', async () => {
    const text = 'Clean OCR text.';
    const filePath = path.join(issueDir, 'issue.txt');
    writeFileSync(filePath, text, 'utf-8');
    await writeProvenance(
      companionYamlPath(filePath),
      baseProvenance({
        ocr_quality: {
          method: 'aspell-realword-ratio-v1',
          language: 'fr',
          ratio: 0.95,
          tier: 'high',
        },
      }),
    );

    const result = await selectSummaryInput(req(loadedSource({ language: 'English' })));

    expect(result.inputQuality).toBeUndefined();
  });

  it('returns archive-relative-to-issue paths for input_layers (not absolute paths)', async () => {
    const text = 'Some English-language OCR text.';
    writeFileSync(path.join(issueDir, 'issue.txt'), text, 'utf-8');

    const result = await selectSummaryInput(req(loadedSource({ language: 'English' })));

    for (const layer of result.layers) {
      expect(path.isAbsolute(layer.path)).toBe(false);
    }
  });

  describe('empty/whitespace-only text layers (AUDIT-20260722-06)', () => {
    it('fails loud when issue.txt is present but truly empty (0 bytes), no translation', async () => {
      writeFileSync(path.join(issueDir, 'issue.txt'), '', 'utf-8');

      await expect(
        selectSummaryInput(req(loadedSource({ language: 'English' }))),
      ).rejects.toThrow(/issue\.txt/);
      await expect(
        selectSummaryInput(req(loadedSource({ language: 'English' }))),
      ).rejects.toThrow(/empty|whitespace/);
    });

    it('fails loud when issue.txt is present but whitespace-only, no translation', async () => {
      writeFileSync(path.join(issueDir, 'issue.txt'), '   \n\t\n  ', 'utf-8');

      await expect(
        selectSummaryInput(req(loadedSource({ language: 'English' }))),
      ).rejects.toThrow(/issue\.txt/);
      await expect(
        selectSummaryInput(req(loadedSource({ language: 'English' }))),
      ).rejects.toThrow(/empty|whitespace/);
    });

    it('fails loud when issue.en.txt is present but truly empty (0 bytes), even with a good issue.txt', async () => {
      writeFileSync(
        path.join(issueDir, 'issue.txt'),
        'Le journal rapporte une reunion publique.',
        'utf-8',
      );
      writeFileSync(path.join(issueDir, 'issue.en.txt'), '', 'utf-8');

      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/issue\.en\.txt/);
      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/empty|whitespace/);
    });

    it('fails loud when issue.en.txt is present but whitespace-only, even with a good issue.txt', async () => {
      writeFileSync(
        path.join(issueDir, 'issue.txt'),
        'Le journal rapporte une reunion publique.',
        'utf-8',
      );
      writeFileSync(path.join(issueDir, 'issue.en.txt'), '  \n  \n', 'utf-8');

      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/issue\.en\.txt/);
      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/empty|whitespace/);
    });

    it('fails loud when both issue.txt and issue.en.txt are truly empty (0 bytes)', async () => {
      writeFileSync(path.join(issueDir, 'issue.txt'), '', 'utf-8');
      writeFileSync(path.join(issueDir, 'issue.en.txt'), '', 'utf-8');

      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/issue\.txt/);
      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/issue\.en\.txt/);
      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/empty|whitespace/);
    });

    it('fails loud when both issue.txt and issue.en.txt are whitespace-only', async () => {
      writeFileSync(path.join(issueDir, 'issue.txt'), '\n\n', 'utf-8');
      writeFileSync(path.join(issueDir, 'issue.en.txt'), '   ', 'utf-8');

      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/issue\.txt/);
      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/issue\.en\.txt/);
      await expect(
        selectSummaryInput(req(loadedSource({ language: 'French' }))),
      ).rejects.toThrow(/empty|whitespace/);
    });
  });
});

/**
 * Source-group MEMBER (Papers Past) convergence (spec 017): a member whose
 * reading text is a DETACHED `ocr-text` asset is materialized into a standard
 * `issue.txt` (+ full-`ProvenanceFields` sidecar) via `materializeIssueText`,
 * then selected through the NORMAL English-OCR path -- the layer path is
 * `issue.txt` (not the raw B2 key) and its `origin` DERIVES from the
 * materialized sidecar's `source_representation`. `issueDir` is the member's
 * flat archive dir (== the dir `materializeIssueText` writes into), which the
 * fixture provides. A fake `ObjectStore` serves the asset bytes.
 */
describe('selectSummaryInput for a source-group member (materializeIssueText convergence)', () => {
  let fixture: WriteMemberFixtureResult | undefined;

  afterEach(() => {
    fixture?.cleanup();
    fixture = undefined;
  });

  async function member(sourceId: string, ocrText: string): Promise<WriteMemberFixtureResult> {
    return writeMemberFixture({
      groupId: 'PB-G930',
      sourceId,
      case: 'port-breton',
      slug: `member-clipping-${sourceId.toLowerCase()}`,
      pageCount: 1,
      articleDate: '1880-04-01',
      ocrText,
      language: 'English',
      sourceArchive: 'Papers Past',
    });
  }

  it('materializes issue.txt from the ocr-text asset and returns a single papers-past-ocr layer (path issue.txt, no translation)', async () => {
    const ocrText = 'THREATENED INVASION OF WESTERN AUSTRALIA. The Evening Star reports ...';
    fixture = await member('PB-P931', ocrText);

    const result = await selectSummaryInput({
      issueDir: fixture.sourceDir,
      source: memberLoadedSource(fixture),
      archiveRoot: fixture.archiveRoot,
      objectStore: fixture.objectStore,
    });

    // Exactly ONE layer: the materialized issue.txt, attributed as
    // source-downloaded Papers Past OCR -- path is issue.txt (the canonical
    // materialized filename), NOT the raw B2 object-store key.
    expect(result.layers).toEqual([
      {
        path: 'issue.txt',
        sha256: fixture.ocrTextSha256,
        origin: 'papers-past-ocr',
        sourceRepresentation: 'papers-past-text-tab',
      },
    ]);
    expect(result.text).toContain('THREATENED INVASION');
    expect(result.text).not.toContain('FRENCH OCR TEXT');
  });

  it('fails loud (no silent skip) when a member needs materialization but no ObjectStore is provided', async () => {
    fixture = await member('PB-P932', 'Some OCR reading text.');

    await expect(
      selectSummaryInput({
        issueDir: fixture.sourceDir,
        source: memberLoadedSource(fixture),
        archiveRoot: fixture.archiveRoot,
        // objectStore intentionally omitted.
      }),
    ).rejects.toThrow(/ObjectStore/);
  });

  it('fails loud on an ocr-text checksum mismatch (materializeIssueText contract)', async () => {
    fixture = await member('PB-P933', 'Correct OCR text.');
    const tampered = memberLoadedSource(fixture);
    tampered.records[0].assets = (tampered.records[0].assets ?? []).map(
      (asset): AcquiredAsset =>
        asset.role === 'ocr-text' ? { ...asset, checksum: 'deadbeef'.repeat(8) } : asset,
    );

    await expect(
      selectSummaryInput({
        issueDir: fixture.sourceDir,
        source: tampered,
        archiveRoot: fixture.archiveRoot,
        objectStore: fixture.objectStore,
      }),
    ).rejects.toThrow(/checksum|mismatch|sha256|PB-P933/i);
  });
});
