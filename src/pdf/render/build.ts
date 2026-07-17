/**
 * The single-item build orchestrator (T021, spec 007): render ONE bibliographic
 * item to a real PDF, end to end. Generalizes the proven flow in
 * `scripts/render-sample-pdf.ts` behind an injectable, fail-loud API.
 *
 * Pipeline (contracts/cli.md, contracts/typst-template.md):
 *  1. Build the pure Edition DIRECTLY from the private archive (spec 014, T008)
 *     via `makeArchiveEditionReader` + concrete readers (bibliography SSOT +
 *     pin sidecar) -- no committed snapshot in the loop.
 *  2. Stage a per-source build dir under the output root; for each page fetch the
 *     print-resolution bytes via the configured `ImageByteSource`
 *     (`b2` -> sha256-verified master; `iiif` -> full-size alternate) and write
 *     them under a stable `<folioId>.jpg` name matching `versoImagePath`.
 *  3. Serialize the Edition to the Typst input JSON.
 *  4. Shell `typst compile` via the injected {@link TypstRunner}, with `--root`
 *     set to the repo root so the template, input JSON, and images all resolve.
 *
 * Fail-loud throughout (Principle III): a missing datum, a failed fetch, a
 * sha256 mismatch (b2), or a Typst error aborts with a message naming the item.
 * No fallbacks, no placeholder images, no partial PDFs.
 */

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import { resolveArchiveRoot } from '@/archive/location';
import { resolvePdfConfig, type PdfImageProviderKind } from '@/pdf/config';
import { makeArchivePinReader, type CorpusSnapshotReader } from '@/pdf/load/edition';
import {
  makeArchiveEditionReader,
  type ArchiveEditionReader,
} from '@/pdf/load/archive-edition';
import { makeSourceMetaReader } from '@/pdf/load/source-meta';
import { makeB2ImageSource } from '@/pdf/images/b2-source';
import { makeIiifImageSource } from '@/pdf/images/iiif-source';
import type { FetchFn, FetchResponse, ImageByteSource } from '@/pdf/images/fetch';
import type { EditionPage } from '@/pdf/model';
import { serializeTypstInput, toTypstInput } from '@/pdf/render/typst-input';
import {
  defaultExecRunner,
  makeTypstRunner,
  type TypstRunner,
} from '@/pdf/render/typst-runner';

/** Path of the Typst template + vendored fonts, relative to the repo root. */
const TEMPLATE_REL = path.join('pdf', 'template', 'edition.typ');
const FONTS_REL = path.join('pdf', 'template', 'fonts');

/** Options for {@link buildItem}. All are optional; production defaults to config + real I/O. */
export interface BuildItemOptions {
  /** Image byte provider; overrides the resolved config (`PdfConfig.imageProvider`). */
  provider?: PdfImageProviderKind;
  /** Output root dir; overrides the resolved config (`PdfConfig.outDir`, default `build/pdf`). */
  outDir?: string;
  /**
   * Recto render mode; overrides the resolved config (`PdfConfig.showFrench`).
   * `true` renders the two-column parallel FR|EN recto; `false` the
   * English-only recto (DESIGN.md § "Variant: English-only recto"). The CLI
   * `--no-french` flag sets this to `false` (CLI overrides env).
   */
  showFrench?: boolean;
  /** Environment used to resolve config + the B2 CDN base; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Injected HTTP GET (tests supply an in-memory fake); defaults to the global `fetch`. */
  fetchFn?: FetchFn;
  /** Injected Typst runner (tests supply a fake); defaults to the real shell-out runner. */
  typst?: TypstRunner;
  /**
   * Explicit private archive root; overrides `COLONY_ARCHIVE_ROOT`
   * (`resolveArchiveRoot`'s override precedence). Fail-loud if neither is set.
   */
  archiveRoot?: string;
  /**
   * Injected archive-direct Edition reader (tests); defaults to the concrete
   * `makeArchiveEditionReader` reader (spec 014, T007) built over the resolved
   * archive root + SSOT + pin readers.
   */
  editionReader?: ArchiveEditionReader;
  /**
   * ACCEPTED BUT IGNORED (spec 014, T008): `buildItem` no longer sources the
   * Edition from the committed snapshot, so a caller-injected snapshot reader
   * has nothing to feed. Kept in the type only because `batch.ts` (a separate
   * task) still threads `opts.snapshotReader` through; remove once that
   * caller drops it too.
   */
  snapshotReader?: CorpusSnapshotReader;
}

/** The result of a single-item build: where the PDF was written. */
export interface BuildItemResult {
  /** Absolute path to the rendered PDF. */
  outPath: string;
}

/** Wrap a `FetchFn`, defaulting to a global-`fetch` adapter that yields a {@link FetchResponse}. */
function resolveFetchFn(injected: FetchFn | undefined): FetchFn {
  if (injected !== undefined) {
    return injected;
  }
  return async (url: string): Promise<FetchResponse> => {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'corpus-print-pdf build (T021)' },
    });
    return {
      ok: response.ok,
      status: response.status,
      arrayBuffer: () => response.arrayBuffer(),
    };
  };
}

/**
 * Build the {@link ImageByteSource} for `provider`. The `b2` source needs a CDN
 * base fronting the public bucket (`CORPUS_CDN_BASE`); its absence is fail-loud
 * (no default url is invented -- Principle III).
 */
function makeImageSource(
  provider: PdfImageProviderKind,
  fetchFn: FetchFn,
  env: NodeJS.ProcessEnv,
): ImageByteSource {
  if (provider === 'iiif') {
    return makeIiifImageSource(fetchFn);
  }
  const cdnBase = env.CORPUS_CDN_BASE?.trim();
  if (!cdnBase) {
    throw new Error(
      'buildItem: provider "b2" requires CORPUS_CDN_BASE (the public CDN base fronting the B2 ' +
        'bucket, e.g. https://cdn.example/pb). Set it or build with --provider iiif.',
    );
  }
  return makeB2ImageSource(cdnBase, fetchFn);
}

/** Stable verso filename for a folio (matches `typst-input.ts`'s `versoImagePath`). */
function versoName(folioId: string): string {
  return `${folioId}.jpg`;
}

/**
 * Render an on-disk path as the repo-root-relative form Typst expects in
 * `sys.inputs` (leading `/`, POSIX separators) when `--root` is the repo root.
 * `absPath` must live under `repoRoot`; a path outside it fails loud rather than
 * emit a `..`-escaping value Typst would reject.
 */
function toRootRelative(repoRoot: string, absPath: string): string {
  const rel = path.relative(repoRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `buildItem: build path ${absPath} is not under the Typst root ${repoRoot}; the template ` +
        'can only read files sandboxed under --root. Use an --out under the repo root.',
    );
  }
  return `/${rel.split(path.sep).join('/')}`;
}

/**
 * Fetch every page's image bytes and stage them under `imageDir` as
 * `<folioId>.jpg`. The `b2` source sha256-verifies against the recorded master
 * checksum internally (`assertMasterSha256Match`); the `iiif` alternate records
 * its own derivative checksum. Fails loud (naming the folio) on any fetch or
 * verification failure.
 *
 * Archive-direct (spec 014): `pages` are the `Edition`'s own `EditionPage[]`,
 * already assembled by `ArchiveEditionReader.build`. Each page's
 * `image.objectStoreKey`/`image.sha256` are the folio's image-master key/hash,
 * already validated non-empty by `resolveArchiveSource` -- no re-derivation
 * needed here. Archive-direct pages carry no per-page ark (see
 * `@/pdf/load/archive-edition`'s module doc), so `ark` is always `null`,
 * routing every fetch through the `b2` provider path.
 */
async function stageImages(
  source: ImageByteSource,
  pages: EditionPage[],
  imageDir: string,
): Promise<void> {
  for (const page of pages) {
    const fetched = await source.fetch({
      folioId: page.folioId,
      ark: null,
      objectStoreKey: page.image.objectStoreKey,
      sha256: page.image.sha256,
    });
    copyFileSync(fetched.bytesPath, path.join(imageDir, versoName(page.folioId)));
  }
}

/**
 * Build ONE bibliographic item to a real PDF and return its output path.
 *
 * @param sourceId snapshot source id (e.g. `PB-P001`).
 * @param itemId issue id for a periodical issue, or the source id for a monograph.
 * @throws Error on any fail-loud violation: unknown source/issue, missing datum,
 *   failed image fetch, sha256 mismatch (b2), or a Typst compile failure.
 */
export async function buildItem(
  sourceId: string,
  itemId: string,
  opts: BuildItemOptions = {},
): Promise<BuildItemResult> {
  const env = opts.env ?? process.env;
  const config = resolvePdfConfig(env);
  const repoRoot = resolveRepoRoot();
  const provider = opts.provider ?? config.imageProvider;
  const showFrench = opts.showFrench ?? config.showFrench;

  // 1. Assemble the pure Edition DIRECTLY from the private archive (spec 014,
  //    T008) -- no committed snapshot in the loop. The pin sidecar
  //    (`config.pinFile` = `site/data/archive-source.json`) is still read for
  //    the colophon's `archiveRef`.
  const archiveRoot = resolveArchiveRoot(repoRoot, opts.archiveRoot, env);
  const editionReader =
    opts.editionReader ??
    makeArchiveEditionReader({
      archiveRoot,
      repoRoot,
      sourceMeta: makeSourceMetaReader(repoRoot),
      pin: makeArchivePinReader(config.pinFile),
      imageProvider: provider,
    });
  const edition = await editionReader.build(sourceId, itemId);

  // 2. Stage the per-source build dir (under the output root, itself under the
  //    repo root by default) + a per-item images dir. Everything the Typst run
  //    reads must live under `--root` (= repoRoot), so we stage under the repo,
  //    not os.tmpdir().
  const outRoot = path.isAbsolute(opts.outDir ?? config.outDir)
    ? (opts.outDir ?? config.outDir)
    : path.join(repoRoot, opts.outDir ?? config.outDir);
  const buildDir = path.join(outRoot, sourceId);
  const imageDir = path.join(buildDir, `${itemId}.images`);
  rmSync(imageDir, { recursive: true, force: true });
  mkdirSync(imageDir, { recursive: true });

  const fetchFn = resolveFetchFn(opts.fetchFn);
  const imageSource = makeImageSource(provider, fetchFn, env);
  await stageImages(imageSource, edition.pages, imageDir);

  // 3. Serialize the Typst input JSON under the build dir.
  const inputPath = path.join(buildDir, `${itemId}.input.json`);
  writeFileSync(inputPath, serializeTypstInput(toTypstInput(edition, showFrench)));

  // 4. Compile the facing-page template to a real PDF. The template reads its
  //    `data`/`images` via `sys.inputs`, and Typst treats those path strings as
  //    ROOT-RELATIVE (sandboxed to `--root`). With `--root = repoRoot`, the
  //    `--input` values must therefore be repo-root-relative (leading `/`), not
  //    real absolute paths -- an absolute path would be re-joined onto the root
  //    and doubled. The files themselves live on disk at their real paths.
  const outPath = path.join(buildDir, `${itemId}.pdf`);
  const typst = opts.typst ?? makeTypstRunner(defaultExecRunner());
  const result = await typst.compile({
    templatePath: path.join(repoRoot, TEMPLATE_REL),
    inputPath: toRootRelative(repoRoot, inputPath),
    imageDir: toRootRelative(repoRoot, imageDir),
    outPath,
    fontPath: path.join(repoRoot, FONTS_REL),
    root: repoRoot,
  });

  return { outPath: result.outPath };
}
