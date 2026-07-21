import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeRecordCompanions } from '@/archive/write-record-companions';
import type { CompanionObjectStore } from '@/archive/write-record-companions';
import type { Source } from '@/model/source';
import type { RepositoryRecord } from '@/model/repository-record';

const COORDS: CompanionObjectStore = {
  provider: 'backblaze-b2',
  bucket: 'colony-cults',
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
};

const NOW = '2026-07-20T00:00:00.000Z';

function baseSource(): Source {
  return {
    sourceId: 'PB-P061',
    titles: [{ text: 'A Papers Past Article', role: 'canonical' }],
    kind: 'archival-item',
    case: 'port-breton',
    language: 'English',
    identifiers: [],
  };
}

/**
 * T024 (companion writer): the two record shapes `writeRecordCompanions`
 * places by its else-branch -- an `ocr-text` asset (Task 4) and a plain
 * `repository-source` asset (pre-existing, unchanged) -- share one source so
 * the OCR case's additive `source_representation` field is proven NOT to leak
 * onto a sibling non-OCR companion.
 */
describe('writeRecordCompanions: ocr-text companion', () => {
  let archiveRoot: string;
  const sha = 'b'.repeat(64);

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-write-record-companions-'));
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('writes an ocr-text companion with source_representation + charset', async () => {
    const source = baseSource();
    const record: RepositoryRecord = {
      sourceId: 'PB-P061',
      sourceArchive: 'Papers Past',
      catalogUrl: 'https://paperspast.natlib.govt.nz/newspapers/example',
      originalUrl: 'https://paperspast.natlib.govt.nz/newspapers/example',
      status: 'archived',
      retrievedAt: NOW,
      rightsAssessment: {
        rightsStatus: 'public-domain',
        rightsBasis: 'out-of-copyright',
        assessedBy: 'operator',
        assessedAt: NOW,
      },
      assets: [
        {
          sourceUrl: 'https://paperspast.natlib.govt.nz/newspapers/example/text',
          mediaType: 'text/plain; charset=utf-8',
          objectStoreKey: `archive/papers-past/PB-P061/${sha}.txt`,
          checksum: sha,
          byteLength: 42,
          provenancePath: `archive/papers-past/PB-P061/${sha}.yml`,
          role: 'ocr-text',
          sourceRepresentation: 'papers-past-text-tab',
        },
      ],
    };

    const written = await writeRecordCompanions({
      source,
      record,
      archiveRoot,
      objectStore: COORDS,
      now: NOW,
    });

    const yamlPath = written.find((p) => p.endsWith(`${sha}.yml`));
    if (!yamlPath) throw new Error('expected a written companion .yml path');
    const yml = readFileSync(yamlPath, 'utf-8');
    expect(yml).toContain('type: "ocr-text"');
    expect(yml).toContain('format: "text/plain; charset=utf-8"');
    expect(yml).toContain('source_representation: "papers-past-text-tab"');
  });

  it('leaves a sibling non-OCR (repository-source) companion unchanged: no source_representation, type source-document', async () => {
    const source = baseSource();
    const pdfSha = 'c'.repeat(64);
    const record: RepositoryRecord = {
      sourceId: 'PB-P061',
      sourceArchive: 'Papers Past',
      catalogUrl: 'https://paperspast.natlib.govt.nz/newspapers/example',
      originalUrl: 'https://paperspast.natlib.govt.nz/newspapers/example',
      status: 'archived',
      retrievedAt: NOW,
      rightsAssessment: {
        rightsStatus: 'public-domain',
        rightsBasis: 'out-of-copyright',
        assessedBy: 'operator',
        assessedAt: NOW,
      },
      assets: [
        {
          sourceUrl: 'https://paperspast.natlib.govt.nz/newspapers/example/pdf',
          mediaType: 'application/pdf',
          objectStoreKey: `archive/papers-past/PB-P061/${pdfSha}.pdf`,
          checksum: pdfSha,
          byteLength: 4096,
          provenancePath: `archive/papers-past/PB-P061/${pdfSha}.yml`,
          role: 'repository-source',
        },
      ],
    };

    const written = await writeRecordCompanions({
      source,
      record,
      archiveRoot,
      objectStore: COORDS,
      now: NOW,
    });

    const yamlPath = written.find((p) => p.endsWith(`${pdfSha}.yml`));
    if (!yamlPath) throw new Error('expected a written companion .yml path');
    const yml = readFileSync(yamlPath, 'utf-8');
    expect(yml).toContain('type: "source-document"');
    expect(yml).not.toContain('source_representation');
  });
});
