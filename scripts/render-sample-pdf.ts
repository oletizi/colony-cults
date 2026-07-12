/**
 * scripts/render-sample-pdf.ts
 *
 * End-to-end SAMPLE render of the facing-page facsimile edition (T020): build a
 * real issue Edition from the committed snapshot, serialize it to the Typst
 * input JSON, fetch that issue's page images from Gallica's public IIIF
 * endpoint, and compile `pdf/template/edition.typ` to a real PDF so a human can
 * inspect the design centerpiece.
 *
 * This is a reusable render harness (it also seeds T021's build orchestrator).
 * It is NOT the production build path -- production fetches print-resolution
 * bytes from the B2 object store and sha256-verifies them; here we pull the
 * Gallica IIIF rendering (which differs from the B2 master) purely so the visual
 * render has real page scans. No sha256 verification is performed on these IIIF
 * bytes for that reason.
 *
 * Usage:
 *   npm run pdf:render-sample
 *   SAMPLE_SOURCE_ID=PB-P001 SAMPLE_ISSUE_ID=1879-07-15_bpt6k5603637g \
 *     SAMPLE_OUT=/tmp/sample.pdf npm run pdf:render-sample
 *
 * Requires the `typst` binary on PATH and the vendored fonts under
 * `pdf/template/fonts/`.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { CorpusSnapshot, RawIssue, RawPage, RawSource } from '@/browser/model';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { resolvePdfConfig } from '@/pdf/config';
import {
  makeArchivePinReader,
  makeCorpusSnapshotReader,
  makeEditionBuilder,
} from '@/pdf/load/edition';
import { makeSourceMetaReader } from '@/pdf/load/source-meta';
import { serializeTypstInput, toTypstInput } from '@/pdf/render/typst-input';

const execFileAsync = promisify(execFile);

const DEFAULT_SOURCE_ID = 'PB-P001';
const DEFAULT_ISSUE_ID = '1879-07-15_bpt6k5603637g';
const GALLICA_IIIF_BASE = 'https://gallica.bnf.fr/iiif';

/**
 * Selects the RawSource for `sourceId`, or throws.
 */
function selectSource(snapshot: CorpusSnapshot, sourceId: string): RawSource {
  const source = snapshot.sources.find((candidate) => candidate.sourceId === sourceId);
  if (source === undefined) {
    throw new Error(
      `render-sample-pdf: snapshot has no source ${sourceId} ` +
        `(found: ${snapshot.sources.map((s) => s.sourceId).join(', ') || 'none'}).`,
    );
  }
  return source;
}

/**
 * Selects the requested issue, falling back to the first issue that has pages
 * so the sample always renders something buildable.
 */
function selectIssue(source: RawSource, issueId: string): RawIssue {
  const exact = source.issues.find((candidate) => candidate.issueId === issueId);
  if (exact !== undefined && exact.pages.length > 0) {
    return exact;
  }
  const firstBuildable = source.issues.find((candidate) => candidate.pages.length > 0);
  if (firstBuildable === undefined) {
    throw new Error(
      `render-sample-pdf: source ${source.sourceId} has no issue with pages in the snapshot.`,
    );
  }
  return firstBuildable;
}

/**
 * Normalizes a zero-padded archive folio id (`f001`) to the un-padded form
 * Gallica's IIIF service addresses (`f1`) -- mirrors
 * `src/browser/providers/source-iiif.ts`'s `gallicaFolio`.
 */
function gallicaFolio(folioId: string): string {
  const match = /^f(\d+)$/.exec(folioId);
  if (match === null) {
    throw new Error(
      `render-sample-pdf: unexpected folioId ${JSON.stringify(folioId)} -- expected "f<digits>".`,
    );
  }
  return `f${Number(match[1])}`;
}

/**
 * Fetches one page's Gallica IIIF rendering and writes it as `<folioId>.jpg`
 * into `imagesDir`. Fails loud on a non-OK response or empty body.
 */
async function fetchPageImage(page: RawPage, imagesDir: string): Promise<void> {
  const ark = page.ark?.trim();
  if (ark === undefined || ark.length === 0) {
    throw new Error(`render-sample-pdf: page ${page.folioId} has no ark -- cannot build IIIF url.`);
  }
  const url = `${GALLICA_IIIF_BASE}/${ark}/${gallicaFolio(page.folioId)}/full/max/0/default.jpg`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'corpus-print-pdf sample render (T020)' },
  });
  if (!response.ok) {
    throw new Error(
      `render-sample-pdf: IIIF fetch failed for ${page.folioId} (HTTP ${response.status}) at ${url}.`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`render-sample-pdf: IIIF fetch returned empty body for ${page.folioId} at ${url}.`);
  }
  writeFileSync(path.join(imagesDir, `${page.folioId}.jpg`), bytes);
  process.stdout.write(`  fetched ${page.folioId} (${(bytes.length / 1024).toFixed(0)} KiB)\n`);
}

/**
 * Counts pages in a compiled PDF by tallying `/Type/Page` objects (excluding the
 * single `/Type/Pages` tree node). Typst writes an uncompressed page tree, so
 * these markers are directly greppable.
 */
function pdfPageCount(pdfPath: string): number {
  const text = readFileSync(pdfPath, 'latin1');
  const matches = text.match(/\/Type\s*\/Page(?![s])/g);
  return matches === null ? 0 : matches.length;
}

async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const config = resolvePdfConfig(process.env);

  const sourceId = process.env.SAMPLE_SOURCE_ID?.trim() || DEFAULT_SOURCE_ID;
  const requestedIssueId = process.env.SAMPLE_ISSUE_ID?.trim() || DEFAULT_ISSUE_ID;
  const outPath = process.env.SAMPLE_OUT?.trim() || path.join(repoRoot, 'build', 'pdf', 'sample.pdf');

  // 1. Build the real Edition from the committed snapshot (concrete readers).
  const snapshotReader = makeCorpusSnapshotReader(config.snapshotDir);
  const rawSnapshot = snapshotReader.read(sourceId);
  const source = selectSource(rawSnapshot, sourceId);
  const issue = selectIssue(source, requestedIssueId);
  process.stdout.write(`Building ${sourceId} / ${issue.issueId} (${issue.pages.length} pages)\n`);

  const builder = makeEditionBuilder({
    snapshot: snapshotReader,
    sourceMeta: makeSourceMetaReader(repoRoot),
    pin: makeArchivePinReader(config.pinFile),
    imageProvider: config.imageProvider,
  });
  const edition = builder.build(sourceId, issue.issueId);

  // 2. Serialize to the Typst input JSON in a temp working dir.
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'corpus-pdf-sample-'));
  const imagesDir = path.join(workDir, 'images');
  mkdirSync(imagesDir, { recursive: true });
  const dataPath = path.join(workDir, 'edition.json');
  // The sample renderer builds the default parallel FR|EN study recto.
  writeFileSync(dataPath, serializeTypstInput(toTypstInput(edition, true)));

  // 3. Fetch each page image from Gallica IIIF into <folioId>.jpg.
  process.stdout.write(`Fetching ${issue.pages.length} page images from Gallica IIIF...\n`);
  for (const page of issue.pages) {
    await fetchPageImage(page, imagesDir);
  }

  // 4. Compile pdf/template/edition.typ to a real PDF.
  //
  // `--root /`: the template reads its JSON + images via absolute `sys.inputs`
  // paths (here under os.tmpdir), and Typst sandboxes file reads to the root
  // while treating absolute paths as root-relative -- so the root must contain
  // both the template (in the repo) and the temp inputs; their common ancestor
  // is the filesystem root. `--font-path`: resolve the vendored OFL faces.
  // (T021's runner must pass the equivalent --root + --font-path.)
  const templatePath = path.join(repoRoot, 'pdf', 'template', 'edition.typ');
  const fontPath = path.join(repoRoot, 'pdf', 'template', 'fonts');
  mkdirSync(path.dirname(outPath), { recursive: true });

  const args = [
    'compile',
    templatePath,
    outPath,
    '--root',
    '/',
    '--font-path',
    fontPath,
    '--ignore-system-fonts',
    '--input',
    `data=${dataPath}`,
    '--input',
    `images=${imagesDir}`,
  ];
  process.stdout.write(`Compiling: typst ${args.join(' ')}\n`);
  try {
    const { stderr } = await execFileAsync('typst', args);
    if (stderr.trim().length > 0) {
      process.stdout.write(`typst stderr:\n${stderr}\n`);
    }
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new Error(
      `render-sample-pdf: "typst compile" failed -- ${err.stderr?.trim() || err.message || String(error)}`,
    );
  }

  // 5. Report.
  const pages = pdfPageCount(outPath);
  if (pages < 2) {
    throw new Error(`render-sample-pdf: expected a multi-page PDF, got ${pages} page(s) at ${outPath}.`);
  }
  process.stdout.write(`\nOK -- wrote ${outPath} (${pages} pages).\n`);
  process.stdout.write(`Working inputs kept at ${workDir}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
