import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ParsedArgs } from '@/cli/parse';
import {
  runRestoreImages,
  type RestoreImagesCliDeps,
} from '@/cli/restore-images';
import { runOcr, type OcrCliDeps } from '@/cli/ocr';
import type { OcrCommandRunner } from '@/ocr/types';
import type { RestoreImagesResult } from '@/archive/public-cache';

/**
 * CLI-level coverage for the public-B2-cache image restore: the standalone
 * `restore-images` verb (including its monograph dir resolution) and the
 * auto-restore the `ocr` command performs before OCRing. Both use injected
 * side effects -- no real network, no real OCR toolchain.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

const ALL_FLAGS = {
  dryRun: false,
  force: false,
  verify: false,
  ocr: false,
  enhanceContrast: false,
  objectStore: false,
  reconcileRemote: false,
  checkpoint: false,
};

function pageProvenance(n: number): ProvenanceFields {
  const stem = `f${String(n).padStart(3, '0')}`;
  return {
    id: 'PB-P002',
    title: 'Nouvelle-France',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k58039518',
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-10T00:00:00.000Z',
    local_path: `archive/cases/port-breton/books/nf/${stem}.jpg`,
    sha256: 'deadbeef',
    size: 0,
    format: 'image/jpeg',
    ocr_status: 'none',
    object_store: {
      provider: 'backblaze-b2',
      bucket: 'colony-cults',
      key: `archive/cases/port-breton/books/nf/${stem}.jpg`,
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
    },
    rights_raw: '<results/>',
    notes: null,
  };
}

/** Build a fetched MONOGRAPH (PB-P002) tmp archive with companions, no images. */
async function monographArchive(): Promise<{ archiveRoot: string; dir: string }> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-restore-'));
  dirs.push(archiveRoot);
  const dir = path.join(
    archiveRoot,
    'archive/cases/port-breton/books/nouvelle-france-colonie-libre-port-breton',
  );
  mkdirSync(dir, { recursive: true });
  await writeProvenance(path.join(dir, 'f001.yml'), pageProvenance(1));
  await writeProvenance(path.join(dir, 'f002.yml'), pageProvenance(2));
  return { archiveRoot, dir };
}

function restoreArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'restore-images',
    positional: ['bpt6k58039518'],
    flags: { ...ALL_FLAGS },
    options: { sourceId: 'PB-P002' },
    ...overrides,
  };
}

describe('runRestoreImages (verb)', () => {
  it('resolves a monograph flat dir and reports pulled/skipped counts', async () => {
    const { archiveRoot, dir } = await monographArchive();
    let seenDir: string | undefined;
    const deps: RestoreImagesCliDeps = {
      archiveRoot,
      log: (m) => logs.push(m),
      restore: async (issueDir): Promise<RestoreImagesResult> => {
        seenDir = issueDir;
        return {
          restored: [path.join(issueDir, 'f001.jpg'), path.join(issueDir, 'f002.jpg')],
          skipped: [],
        };
      },
    };
    const logs: string[] = [];

    await runRestoreImages(restoreArgs(), deps);

    // The verb resolved the monograph's FLAT slug dir (not a _ark child).
    expect(seenDir).toBe(dir);
    expect(logs.some((l) => l.includes('2 pulled, 0 already local'))).toBe(true);
  });

  it('reports the target dir on --dry-run and does not restore', async () => {
    const { archiveRoot } = await monographArchive();
    let restoreCalled = false;
    const logs: string[] = [];
    const deps: RestoreImagesCliDeps = {
      archiveRoot,
      log: (m) => logs.push(m),
      restore: async () => {
        restoreCalled = true;
        return { restored: [], skipped: [] };
      },
    };

    await runRestoreImages(
      restoreArgs({ flags: { ...ALL_FLAGS, dryRun: true } }),
      deps,
    );

    expect(restoreCalled).toBe(false);
    expect(logs.some((l) => l.includes('dry-run'))).toBe(true);
  });

  it('throws when --source-id is missing', async () => {
    const { archiveRoot } = await monographArchive();
    const deps: RestoreImagesCliDeps = {
      archiveRoot,
      log: () => undefined,
      restore: async () => ({ restored: [], skipped: [] }),
    };

    await expect(
      runRestoreImages(restoreArgs({ options: {} }), deps),
    ).rejects.toThrow(/source-id/);
  });
});

describe('runOcr auto-restore', () => {
  it('restores absent page images from the cache before OCR', async () => {
    const { archiveRoot, dir } = await monographArchive();

    // OCR toolchain fake: writes the expected output files.
    const ocrRunner: OcrCommandRunner = {
      run: async (command, args) => {
        const { writeFile } = await import('node:fs/promises');
        if (command === 'img2pdf') {
          await writeFile(args[args.indexOf('-o') + 1], 'RAW');
        } else if (command === 'ocrmypdf') {
          await writeFile(args[args.length - 1], 'PDFA');
        } else if (command === 'pdftotext') {
          await writeFile(args[args.length - 1], 'OCR TEXT\n');
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };

    let restoreCalledWith: string | undefined;
    const deps: OcrCliDeps = {
      archiveRoot,
      clock: () => new Date('2026-07-10T00:00:00.000Z'),
      log: () => undefined,
      ocrPreflight: async () => undefined,
      ocrRunner,
      restoreImages: async (issueDir): Promise<RestoreImagesResult> => {
        // Simulate the public-cache pull writing the absent images.
        restoreCalledWith = issueDir;
        writeFileSync(path.join(issueDir, 'f001.jpg'), 'IMG1');
        writeFileSync(path.join(issueDir, 'f002.jpg'), 'IMG2');
        return {
          restored: [path.join(issueDir, 'f001.jpg'), path.join(issueDir, 'f002.jpg')],
          skipped: [],
        };
      },
    };

    // Images are absent at the start (migrated); companions are present.
    expect(existsSync(path.join(dir, 'f001.jpg'))).toBe(false);

    await runOcr(restoreArgs({ command: 'ocr' }), deps);

    // Restore ran against the monograph dir, and OCR then produced issue.txt.
    expect(restoreCalledWith).toBe(dir);
    expect(existsSync(path.join(dir, 'issue.txt'))).toBe(true);
  });
});
