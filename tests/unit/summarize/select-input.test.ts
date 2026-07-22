import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { selectSummaryInput, type SummaryInputRequest } from '@/summarize/select-input';
import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import type { LoadedSource } from '@/bibliography/load';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';

/** Lowercase-hex SHA-256, computed independently of the implementation under test. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Minimal source-aware {@link LoadedSource} fixture (FR-018). `language` drives
 * the Gallica French/English routing; `papersPastOcr` (an object-store key +
 * checksum) makes it a Papers Past source with an `ocr-text` asset.
 */
function loadedSource(opts: {
  language?: string;
  papersPastOcr?: { objectStoreKey: string; checksum: string };
} = {}): LoadedSource {
  const source: Source = {
    sourceId: 'PB-P001',
    titles: [{ text: 'Test Source', role: 'canonical' }],
    kind: 'periodical',
    identifiers: [],
    ...(opts.language !== undefined ? { language: opts.language } : {}),
  };
  const records: AuthoredRepositoryRecord[] =
    opts.papersPastOcr === undefined
      ? []
      : [
          {
            sourceArchive: 'Papers Past',
            status: 'archived',
            sourceUrl: 'https://paperspast.natlib.govt.nz/newspapers/ESD18800401.2.28',
            assets: [
              {
                sourceUrl: 'https://paperspast.natlib.govt.nz/newspapers/ESD18800401.2.28',
                mediaType: 'text/plain; charset=utf-8',
                objectStoreKey: opts.papersPastOcr.objectStoreKey,
                checksum: opts.papersPastOcr.checksum,
                byteLength: 100,
                provenancePath: 'archive/papers-past/x/x.yml',
                role: 'ocr-text',
                sequence: 0,
                sourceRepresentation: 'papers-past-text-tab',
              },
            ],
          },
        ];
  return { source, records, identifierLeaks: [] };
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

  it('reads a Papers Past ocr-text asset (English-only, attributed to Papers Past) with NO translation layer', async () => {
    const ocrKey = 'archive/papers-past/esd18800401.2.28/deadbeef.txt';
    const ocrText = 'THREATENED INVASION OF WESTERN AUSTRALIA. The Evening Star reports ...';
    const dest = path.join(archiveRoot, ocrKey);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, ocrText, 'utf-8');

    const result = await selectSummaryInput(
      req(loadedSource({ language: 'English', papersPastOcr: { objectStoreKey: ocrKey, checksum: 'deadbeef' } })),
    );

    // Exactly ONE layer: the Papers Past OCR, attributed as source-downloaded.
    expect(result.layers).toEqual([
      {
        path: ocrKey,
        sha256: sha256(ocrText),
        origin: 'papers-past-ocr',
        sourceRepresentation: 'papers-past-text-tab',
      },
    ]);
    expect(result.text).toContain('THREATENED INVASION');
    // No translation layer, no French OCR delimiters.
    expect(result.text).not.toContain('FRENCH OCR TEXT');
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
