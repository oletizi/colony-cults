/**
 * The source-group MEMBER build orchestrator (spec 017 T008): render ONE
 * member's N page-master segments (a newspaper clipping cut into vertical
 * strips) to a SINGLE collapsed PDF page -- a stacked-segment verso (T006
 * template) facing an english-only recto carrying the whole article's OCR
 * text (T005's materialized `issue.txt`).
 *
 * Deliberately NOT `@/pdf/load/archive-edition`'s generic N-folios-per-source
 * reader: a member has no `bibliography/sources/<id>.yml` SSOT file that
 * generic reader could resolve title/rights from (see
 * `@/pdf/render/member-edition`'s module doc), and its N folios are N
 * SEGMENTS of ONE clipping (collapsed to one page), not N independent pages.
 * This module instead:
 *
 *  1. Materializes `issue.txt` from the member's detached `ocr-text` asset
 *     FIRST (`@/archive/issue-text-materialize`, T005) -- the whole-article
 *     OCR becomes the single page's recto `english`.
 *  2. Assembles the front-matter/colophon/ordered-segments
 *     (`@/pdf/render/member-edition`, pure data).
 *  3. Fetches + sha256-verifies each segment's bytes (reusing `@/pdf/render/
 *     build`'s `ImageByteSource`/`detectImageExt`/`versoName` machinery --
 *     GIF-aware, since Papers-Past-sourced segments are GIFs).
 *  4. Serializes ONE `TypstPage` whose `verso.segments` carries all N staged
 *     segments (ascending order) and compiles it via the injected
 *     `TypstRunner` -- exactly one `typst compile` call, one PDF.
 *
 * Typst root sandboxing (spec 007's `buildItem` convention): the template +
 * fonts live under the repo root, but a caller's `outDir` for a member build
 * is not guaranteed to be a descendant of the repo root (unlike `buildItem`,
 * which always stages under it) -- so `--root` here is the common ancestor
 * of the repo root and the build dir (never a hardcoded `repoRoot`), and the
 * `sys.inputs` paths are that root's relative form (see `toRootRelative`,
 * reused from `@/pdf/render/build`). This never throws (the common ancestor
 * is by construction an ancestor of both), and degrades gracefully to `/`
 * when the build dir falls entirely outside the repo.
 */

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveArchiveRoot } from '@/archive/location';
import { materializeIssueText } from '@/archive/issue-text-materialize';
import type { ObjectStore } from '@/archive/object-store';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { resolvePdfConfig } from '@/pdf/config';
import type { ImageByteSource } from '@/pdf/images/fetch';
import { makeArchivePinReader } from '@/pdf/load/edition';
import {
  detectImageExt,
  FONTS_REL,
  makeImageSource,
  resolveFetchFn,
  TEMPLATE_REL,
  toRootRelative,
  versoName,
  type BuildItemOptions,
  type BuildItemResult,
} from '@/pdf/render/build';
import {
  assembleMemberEdition,
  type MemberPageMasterSegment,
  type MemberWithRecords,
} from '@/pdf/render/member-edition';
import { serializeTypstInput, type TypstInput, type TypstVersoSegment } from '@/pdf/render/typst-input';
import { defaultExecRunner, makeTypstRunner } from '@/pdf/render/typst-runner';

/** Options for {@link buildMemberItem}: everything `BuildItemOptions` offers, plus a required `ObjectStore`. */
export interface BuildMemberOptions extends BuildItemOptions {
  /** Fetches the member's detached `ocr-text` asset bytes (`materializeIssueText`, T005). */
  objectStore: ObjectStore;
}

/**
 * The common ancestor directory of `a` and `b` -- the widest `--root` that
 * still contains both the Typst template/fonts (always under the repo root)
 * and the member's staged build dir (which may or may not be). Degrades to
 * the filesystem root (`/`) when `a`/`b` share nothing else (e.g. a build dir
 * under a system temp dir, unrelated to the repo).
 */
function commonAncestor(a: string, b: string): string {
  const segA = path.resolve(a).split(path.sep);
  const segB = path.resolve(b).split(path.sep);
  const common: string[] = [];
  const max = Math.min(segA.length, segB.length);
  for (let i = 0; i < max; i += 1) {
    if (segA[i] !== segB[i]) {
      break;
    }
    common.push(segA[i]);
  }
  const joined = common.join(path.sep);
  return joined.length > 0 ? joined : path.sep;
}

/**
 * Fetch + sha256-verify every segment's image bytes (via the injected
 * `ImageByteSource`, mirroring `build.ts`'s `stageImages`) and stage them
 * under `imageDir` as `<folioId>.<ext>`, the extension detected from magic
 * bytes (GIF-aware -- Papers-Past segments are GIFs). Returns the staged
 * `TypstVersoSegment[]`, in the SAME (ascending) order as `segments`.
 */
async function stageMemberSegments(
  imageSource: ImageByteSource,
  segments: MemberPageMasterSegment[],
  imageDir: string,
): Promise<TypstVersoSegment[]> {
  const staged: TypstVersoSegment[] = [];
  for (const segment of segments) {
    const fetched = await imageSource.fetch({
      folioId: segment.folioId,
      // Archive-direct members carry no per-segment ark (mirrors build.ts's
      // archive-direct pages -- see `stageImages`'s doc).
      ark: null,
      objectStoreKey: segment.objectStoreKey,
      sha256: segment.sha256,
    });
    const ext = detectImageExt(fetched.bytesPath, segment.folioId);
    const fileName = versoName(segment.folioId, ext);
    copyFileSync(fetched.bytesPath, path.join(imageDir, fileName));
    staged.push({ imagePath: fileName, sha256: fetched.sha256 });
  }
  return staged;
}

/**
 * Build a source-group member's single collapsed PDF page and return its
 * output path.
 *
 * @param member the member's `Source` + its `repositoryRecords` (the caller
 *   loads these from the member's own bibliography SSOT entry -- see
 *   `@/pdf/render/batch`'s `buildSource`).
 * @throws Error on any fail-loud violation: no `page-master` assets, a
 *   missing/mismatched `ocr-text` asset (`materializeIssueText`), a failed
 *   image fetch, a sha256 mismatch, an unresolvable title/rights/date, or a
 *   Typst compile failure.
 */
export async function buildMemberItem(
  member: MemberWithRecords,
  opts: BuildMemberOptions,
): Promise<BuildItemResult> {
  const env = opts.env ?? process.env;
  const config = resolvePdfConfig(env);
  const repoRoot = resolveRepoRoot();
  const provider = opts.provider ?? config.imageProvider;
  const showFrench = opts.showFrench ?? config.showFrench;
  const archiveRoot = resolveArchiveRoot(repoRoot, opts.archiveRoot, env);

  // 1. Materialize issue.txt from the detached ocr-text asset FIRST (T005) --
  //    before anything else reads it. The whole-article OCR becomes the
  //    single page's recto `english`.
  const issueTxtPath = await materializeIssueText(member, archiveRoot, opts.objectStore);
  const englishText = await readFile(issueTxtPath, 'utf-8');

  // 2. Assemble front-matter + colophon + ordered segments (pure data).
  const pin = makeArchivePinReader(config.pinFile);
  const assembly = await assembleMemberEdition(member, archiveRoot, pin);

  // 3. Stage the per-source build dir + image dir.
  const outRoot = path.isAbsolute(opts.outDir ?? config.outDir)
    ? (opts.outDir ?? config.outDir)
    : path.join(repoRoot, opts.outDir ?? config.outDir);
  const buildDir = path.join(outRoot, member.sourceId);
  const imageDir = path.join(buildDir, `${member.sourceId}.images`);
  rmSync(imageDir, { recursive: true, force: true });
  mkdirSync(imageDir, { recursive: true });

  const fetchFn = resolveFetchFn(opts.fetchFn);
  const imageSource = makeImageSource(provider, fetchFn, env);
  const stagedSegments = await stageMemberSegments(imageSource, assembly.segments, imageDir);

  // 4. Collapse into ONE TypstPage: verso.segments carries all N staged
  //    segments (ascending); the required single imagePath/sha256 fields
  //    (unused by the template once segments are present) name the first
  //    segment as the page's primary image. recto.english is the whole
  //    materialized OCR text; ocrFrench is always empty (no French OCR on a
  //    member); machineAssist is always null (no translation is performed).
  const typstInput: TypstInput = {
    itemId: member.sourceId,
    kind: 'monograph',
    titlePage: assembly.titlePage,
    pages: [
      {
        pageId: 'p001',
        folioId: assembly.segments[0].folioId,
        verso: {
          imagePath: stagedSegments[0].imagePath,
          sha256: stagedSegments[0].sha256,
          segments: stagedSegments,
        },
        recto: {
          ocrFrench: '',
          english: englishText,
          ocrCondition: assembly.colophon.ocrTranscription?.caveat ?? null,
          machineAssist: null,
        },
      },
    ],
    colophon: assembly.colophon,
    showFrench,
  };

  const inputPath = path.join(buildDir, `${member.sourceId}.input.json`);
  writeFileSync(inputPath, serializeTypstInput(typstInput));

  // 5. Compile via the same edition.typ template `buildItem` uses (T006's
  //    facsimile-verso already branches on `verso.segments`). `--root` is the
  //    common ancestor of the repo root (template/fonts) and the build dir
  //    (input/images) -- see the module doc.
  const outPath = path.join(buildDir, `${member.sourceId}.pdf`);
  const typstRoot = commonAncestor(repoRoot, buildDir);
  const typst = opts.typst ?? makeTypstRunner(defaultExecRunner());
  const result = await typst.compile({
    templatePath: path.join(repoRoot, TEMPLATE_REL),
    inputPath: toRootRelative(typstRoot, inputPath),
    imageDir: toRootRelative(typstRoot, imageDir),
    outPath,
    fontPath: path.join(repoRoot, FONTS_REL),
    root: typstRoot,
  });

  return { outPath: result.outPath };
}
