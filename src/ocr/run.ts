import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertInsideArchive } from '@/archive/location';
import {
  companionYamlPath,
  isAssetRecorded,
  storeAsset,
  type StoreResult,
} from '@/archive/store';
import {
  readProvenance,
  writeProvenance,
  type ProvenanceFields,
} from '@/archive/provenance';
import { execCommand } from '@/ocr/exec';
import type { OcrCommandRunner } from '@/ocr/types';

/** Injectable dependencies of {@link ocrIssue} (T030). */
export interface OcrContext {
  /** Runs `img2pdf`/`ocrmypdf`/`pdftotext` (real by default, faked in tests). */
  runner: OcrCommandRunner;
  /** Absolute private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** Injected clock for the retrieval timestamp (testability, determinism). */
  clock: () => Date;
  /** Re-run OCR even when `issue.txt` is already recorded. */
  force?: boolean;
  /** Optional line-oriented progress sink. */
  log?: (message: string) => void;
}

/** Outcome of one {@link ocrIssue} call. */
export interface OcrResult {
  /** The issue directory OCR ran against. */
  issueDir: string;
  /** Store outcome for `issue.txt` (plain-text sidecar). */
  text: StoreResult;
}

/** The real (shell-out) command runner, used by CLI wiring in production. */
export function defaultOcrCommandRunner(): OcrCommandRunner {
  return { run: (command, args) => execCommand(command, args) };
}

/** Zero-padded page-image filenames (`f001.jpg`), in page order. */
async function gatherPageImages(issueDir: string): Promise<string[]> {
  const entries = await readdir(issueDir);
  const pages = entries.filter((name) => /^f\d{3}\.jpg$/.test(name)).sort();
  if (pages.length === 0) {
    throw new Error(
      `ocrIssue: no page images (f###.jpg) found in ${issueDir} -- fetch its images first`,
    );
  }
  return pages.map((name) => path.join(issueDir, name));
}

/** Run one external OCR-toolchain step; throw with its captured output on failure. */
async function runStep(
  runner: OcrCommandRunner,
  command: string,
  args: string[],
): Promise<void> {
  const result = await runner.run(command, args);
  if (result.exitCode !== 0) {
    throw new Error(
      `ocrIssue: "${command}" failed (exit ${result.exitCode}): ` +
        `${result.stderr.trim() || result.stdout.trim() || '(no output)'}`,
    );
  }
}

/** Best-effort: stamp `ocr_status` on every page's companion YAML that has one. */
async function markPageOcrStatus(
  pageFiles: string[],
  status: string,
): Promise<void> {
  for (const jpgPath of pageFiles) {
    const yamlPath = companionYamlPath(jpgPath);
    if (!existsSync(yamlPath)) {
      continue;
    }
    const fields = await readProvenance(yamlPath);
    await writeProvenance(yamlPath, { ...fields, ocr_status: status });
  }
}

/** Build the pdf-a/ocr-text provenance record, reusing a page's shared fields. */
function derivedProvenance(
  base: ProvenanceFields,
  type: 'pdf-a' | 'ocr-text',
  format: string,
  retrieved: string,
): ProvenanceFields {
  return {
    ...base,
    type,
    format,
    ocr_status: 'searchable',
    // Derived assets have no single origin URL (data-model.md § Asset).
    original_url: '',
    retrieved,
    // (Re)derived inside storeAsset from the actual bytes and target path.
    local_path: '',
    sha256: '',
    notes: null,
  };
}

/**
 * OCR an already-fetched issue's page images into a plain-text sidecar
 * (T030, FR-011/012). Runs entirely offline against what is already on disk:
 * `img2pdf` -> `ocrmypdf --deskew --rotate-pages --language fra --output-type
 * pdfa` -> `pdftotext`, via the injected `ctx.runner` (an external CLI tool,
 * shelled out -- never a library).
 *
 * The searchable PDF/A is produced only as a TRANSIENT intermediate (the OCR
 * text layer that `pdftotext` reads); it is NOT persisted, because it merely
 * re-embeds the page-image masters already stored as `f###.jpg` and is
 * trivially regenerable from them. Only `issue.txt` + provenance is kept
 * (archive storage decision, 2026-07-08).
 *
 * Rights/catalog metadata for the derived text's provenance is copied from
 * the first page's already-written companion YAML (the rights gate already
 * ran at fetch time; OCR never re-verifies rights or touches the network).
 *
 * Resumable: when `issue.txt` is already recorded and `force` is not set, the
 * toolchain is not re-run. On any tool failure, every page's `ocr_status` is
 * stamped `failed` before the error is rethrown.
 */
export async function ocrIssue(
  issueDir: string,
  ctx: OcrContext,
): Promise<OcrResult> {
  // Guard FIRST, before any filesystem interaction (defense in depth;
  // storeAsset re-checks the actual asset targets below).
  assertInsideArchive(issueDir, ctx.archiveRoot);

  const pageFiles = await gatherPageImages(issueDir);

  const textTarget = path.join(issueDir, 'issue.txt');

  if (ctx.force !== true && (await isAssetRecorded(textTarget))) {
    ctx.log?.('  skip  issue.txt (already recorded)');
    return {
      issueDir,
      text: { path: textTarget, sha256: '', skipped: true },
    };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'gallica-ocr-'));
  try {
    const rawPdf = path.join(workDir, 'raw.pdf');
    const searchablePdf = path.join(workDir, 'issue.pdf');
    const textFile = path.join(workDir, 'issue.txt');

    await runStep(ctx.runner, 'img2pdf', [...pageFiles, '-o', rawPdf]);
    await runStep(ctx.runner, 'ocrmypdf', [
      '--deskew',
      '--rotate-pages',
      '--language',
      'fra',
      '--output-type',
      'pdfa',
      rawPdf,
      searchablePdf,
    ]);
    await runStep(ctx.runner, 'pdftotext', [searchablePdf, textFile]);

    // The searchable PDF (searchablePdf) is intentionally NOT stored -- it only
    // re-embeds the f###.jpg masters and is regenerable from them. Keep the text.
    const textBytes = await readFile(textFile);

    const basePage = await readProvenance(companionYamlPath(pageFiles[0]));
    const retrieved = ctx.clock().toISOString();

    const textResult = await storeAsset(
      textBytes,
      textTarget,
      derivedProvenance(basePage, 'ocr-text', 'text/plain', retrieved),
      ctx.archiveRoot,
      { force: ctx.force },
    );

    await markPageOcrStatus(pageFiles, 'searchable');
    ctx.log?.(
      `  ocr   issue.txt written for ${path.basename(issueDir)} ` +
        `(searchable PDF derived transiently, not stored)`,
    );

    return { issueDir, text: textResult };
  } catch (error) {
    await markPageOcrStatus(pageFiles, 'failed').catch(() => {
      // Best-effort status update; never mask the original failure.
    });
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
