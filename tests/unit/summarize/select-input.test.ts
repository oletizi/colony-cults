import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { selectSummaryInput } from '@/summarize/select-input';
import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';

/** Lowercase-hex SHA-256, computed independently of the implementation under test. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
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

  beforeEach(() => {
    issueDir = mkdtempSync(path.join(tmpdir(), 'cc-select-input-'));
  });

  afterEach(() => {
    rmSync(issueDir, { recursive: true, force: true });
  });

  it('selects issue.txt only when no English translation companion exists', async () => {
    const text = 'Le journal rapporte une reunion publique.';
    writeFileSync(path.join(issueDir, 'issue.txt'), text, 'utf-8');

    const result = await selectSummaryInput(issueDir);

    expect(result.layers).toEqual([{ path: 'issue.txt', sha256: sha256(text) }]);
    expect(result.text).toContain(text);
  });

  it('selects BOTH issue.txt (French OCR) and issue.en.txt (English translation) when both exist', async () => {
    const frenchText = 'Le journal rapporte une reunion publique.';
    const englishText = 'The newspaper reports a public meeting.';
    writeFileSync(path.join(issueDir, 'issue.txt'), frenchText, 'utf-8');
    writeFileSync(path.join(issueDir, 'issue.en.txt'), englishText, 'utf-8');

    const result = await selectSummaryInput(issueDir);

    expect(result.layers).toEqual([
      { path: 'issue.txt', sha256: sha256(frenchText) },
      { path: 'issue.en.txt', sha256: sha256(englishText) },
    ]);
    // Both source texts must be present in the combined text, in some
    // clearly-delimited form (see select-input.ts for the exact format).
    expect(result.text).toContain(frenchText);
    expect(result.text).toContain(englishText);
    // The combined text is not a bare concatenation -- it must delimit the
    // two layers so a reader (human or LLM) can tell which is which.
    expect(result.text.indexOf(frenchText)).toBeLessThan(result.text.indexOf(englishText));
  });

  it('fails loud, naming the missing text, when neither issue.txt nor issue.en.txt exists', async () => {
    await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.txt/);
    await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.en\.txt/);
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

    const result = await selectSummaryInput(issueDir);

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

    const result = await selectSummaryInput(issueDir);

    expect(result.inputQuality).toBeUndefined();
  });

  it('returns archive-relative-to-issue paths for input_layers (not absolute paths)', async () => {
    const text = 'Some English-language OCR text.';
    writeFileSync(path.join(issueDir, 'issue.txt'), text, 'utf-8');

    const result = await selectSummaryInput(issueDir);

    for (const layer of result.layers) {
      expect(path.isAbsolute(layer.path)).toBe(false);
    }
  });

  describe('empty/whitespace-only text layers (AUDIT-20260722-06)', () => {
    // Channel: issue.txt exists but is truly empty (0 bytes), no translation.
    it('fails loud when issue.txt is present but truly empty (0 bytes), no translation', async () => {
      writeFileSync(path.join(issueDir, 'issue.txt'), '', 'utf-8');

      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.txt/);
      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/empty|whitespace/);
    });

    // Channel: issue.txt exists but is whitespace-only (spaces/newlines/tabs), no translation.
    it('fails loud when issue.txt is present but whitespace-only, no translation', async () => {
      writeFileSync(path.join(issueDir, 'issue.txt'), '   \n\t\n  ', 'utf-8');

      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.txt/);
      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/empty|whitespace/);
    });

    // Channel: issue.en.txt exists but is truly empty (0 bytes), issue.txt is good.
    it('fails loud when issue.en.txt is present but truly empty (0 bytes), even with a good issue.txt', async () => {
      writeFileSync(
        path.join(issueDir, 'issue.txt'),
        'Le journal rapporte une reunion publique.',
        'utf-8',
      );
      writeFileSync(path.join(issueDir, 'issue.en.txt'), '', 'utf-8');

      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.en\.txt/);
      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/empty|whitespace/);
    });

    // Channel: issue.en.txt exists but is whitespace-only, issue.txt is good.
    it('fails loud when issue.en.txt is present but whitespace-only, even with a good issue.txt', async () => {
      writeFileSync(
        path.join(issueDir, 'issue.txt'),
        'Le journal rapporte une reunion publique.',
        'utf-8',
      );
      writeFileSync(path.join(issueDir, 'issue.en.txt'), '  \n  \n', 'utf-8');

      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.en\.txt/);
      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/empty|whitespace/);
    });

    // Channel: both issue.txt and issue.en.txt are truly empty (0 bytes).
    it('fails loud when both issue.txt and issue.en.txt are truly empty (0 bytes)', async () => {
      writeFileSync(path.join(issueDir, 'issue.txt'), '', 'utf-8');
      writeFileSync(path.join(issueDir, 'issue.en.txt'), '', 'utf-8');

      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.txt/);
      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.en\.txt/);
      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/empty|whitespace/);
    });

    // Channel: both issue.txt and issue.en.txt are whitespace-only.
    it('fails loud when both issue.txt and issue.en.txt are whitespace-only', async () => {
      writeFileSync(path.join(issueDir, 'issue.txt'), '\n\n', 'utf-8');
      writeFileSync(path.join(issueDir, 'issue.en.txt'), '   ', 'utf-8');

      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.txt/);
      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/issue\.en\.txt/);
      await expect(selectSummaryInput(issueDir)).rejects.toThrow(/empty|whitespace/);
    });
  });
});
