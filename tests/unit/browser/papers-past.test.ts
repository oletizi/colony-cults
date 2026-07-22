import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { loadPapersPastSource } from '@/browser/load/papers-past';
import type { LoadedSource } from '@/bibliography/load';
import type { Source } from '@/model/source';

/**
 * `loadPapersPastSource` builds the Papers Past clipping loader's `RawIssue`
 * + `RawSource` directly (not via the standard periodical/monograph path in
 * `raw-corpus.ts`). AUDIT-20260722-01: it used to skip the
 * `attachIssueSummary`/`attachSourceSummary` enrichment entirely, so a
 * present `issue.summary.short.en.md` / `source.summary.short.en.md` never
 * reached the browser -- a false-absence for an in-scope source family. These
 * tests pin that the loader now routes through the SAME shared enrichment
 * helpers the standard path uses (src/browser/load/summary.ts), and that
 * absence still renders gracefully (honest-absence, no fabrication).
 */

const SOURCE_ID = 'PB-N001';
const CASE = 'port-breton';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Builds an `archive/cases/<case>/newspapers/<slug>/` clipping unit dir with one folio. */
function makeArchiveRoot(): { archiveRoot: string; unitDir: string } {
  const archiveRoot = mkdtempSync(path.join(os.tmpdir(), 'corpus-browser-papers-past-'));
  tempDirs.push(archiveRoot);

  const unitDir = path.join(archiveRoot, 'archive', 'cases', CASE, 'newspapers', 'hns-18840103');
  mkdirSync(unitDir, { recursive: true });

  writeFileSync(
    path.join(unitDir, 'f001.yml'),
    stringify({
      id: SOURCE_ID,
      object_store: { key: 'archive/papers-past/hns-18840103/f001.gif' },
      sha256: 'a'.repeat(64),
      rights_status: 'public-domain',
    }),
    'utf-8'
  );

  const ocrPath = path.join(archiveRoot, 'archive', 'papers-past', 'hns-18840103', 'ocr.txt');
  mkdirSync(path.dirname(ocrPath), { recursive: true });
  writeFileSync(ocrPath, 'The settlers arrived at Port Breton.', 'utf-8');

  return { archiveRoot, unitDir };
}

/** A minimal Papers Past `LoadedSource` (source + Papers Past repository record). */
function makeLoadedSource(): LoadedSource {
  const source: Source = {
    sourceId: SOURCE_ID,
    titles: [{ text: 'Port Breton Settlers Arrive', role: 'canonical' }],
    kind: 'periodical',
    identifiers: [],
    case: CASE,
  };

  return {
    source,
    identifierLeaks: [],
    records: [
      {
        sourceArchive: 'Papers Past',
        status: 'collected',
        sourceUrl: 'https://paperspast.natlib.govt.nz/newspapers/HNS18840103.2.19.3',
        identifiers: [{ type: 'papers-past', value: 'HNS18840103.2.19.3' }],
        assets: [
          {
            sourceUrl: 'https://paperspast.natlib.govt.nz/newspapers/HNS18840103.2.19.3',
            mediaType: 'text/plain',
            objectStoreKey: 'archive/papers-past/hns-18840103/ocr.txt',
            checksum: 'b'.repeat(64),
            byteLength: 37,
            provenancePath: 'archive/papers-past/hns-18840103/ocr.txt.yml',
            role: 'ocr-text',
          },
        ],
      },
    ],
  };
}

function writeConcise(dir: string, filename: string, content: string): void {
  writeFileSync(path.join(dir, filename), content, 'utf-8');
}

function writeSidecar(dir: string, filename: string): void {
  writeFileSync(
    path.join(dir, filename),
    stringify({ engine: 'claude-code-cli', model: 'claude-sonnet-5', retrieved: '2026-07-21' }),
    'utf-8'
  );
}

describe('loadPapersPastSource summary enrichment (AUDIT-20260722-01)', () => {
  it('attaches conciseSummary to both the issue and the source when the artifacts exist', () => {
    const { archiveRoot, unitDir } = makeArchiveRoot();
    writeConcise(unitDir, 'issue.summary.short.en.md', 'A short article on new settlers.');
    writeSidecar(unitDir, 'issue.summary.short.en.md.yml');
    writeConcise(unitDir, 'source.summary.short.en.md', 'Coverage of the Port Breton colony.');
    writeSidecar(unitDir, 'source.summary.short.en.md.yml');

    const rawSource = loadPapersPastSource(archiveRoot, makeLoadedSource(), 'Port Breton Settlers Arrive');

    expect(rawSource.conciseSummary?.concise).toBe('Coverage of the Port Breton colony.');
    expect(rawSource.conciseSummary?.label.engine).toBe('claude-code-cli');
    expect(rawSource.issues).toHaveLength(1);
    expect(rawSource.issues[0].conciseSummary?.concise).toBe('A short article on new settlers.');
    expect(rawSource.issues[0].conciseSummary?.label.engine).toBe('claude-code-cli');
  });

  it('omits conciseSummary on both the issue and the source when no artifact exists (honest absence)', () => {
    const { archiveRoot } = makeArchiveRoot();

    const rawSource = loadPapersPastSource(archiveRoot, makeLoadedSource(), 'Port Breton Settlers Arrive');

    expect(rawSource.conciseSummary).toBeUndefined();
    expect(rawSource.issues[0].conciseSummary).toBeUndefined();
    expect('conciseSummary' in rawSource).toBe(false);
    expect('conciseSummary' in rawSource.issues[0]).toBe(false);
  });
});
