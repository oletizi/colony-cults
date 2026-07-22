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
 * Steps 1-4 above (everything except the final one-page `TypstInput` wrap +
 * compile) are extracted into {@link composeMemberPage} -- the reusable
 * per-member page composer spec 017 T011's `buildGroupEdition`
 * (`@/pdf/render/group-edition`) shares, so a group edition's N member
 * sections are composed through the exact same code path as a standalone
 * member PDF, never a cloned copy of it.
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
import { makeArchivePinReader, type ArchivePinReader } from '@/pdf/load/edition';
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
  type MemberEditionAssembly,
  type MemberPageMasterSegment,
  type MemberWithRecords,
} from '@/pdf/render/member-edition';
import {
  serializeTypstInput,
  type TypstInput,
  type TypstPage,
  type TypstVersoSegment,
} from '@/pdf/render/typst-input';
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
 *
 * Exported so `@/pdf/render/group-edition` (spec 017 T011) sandboxes its own
 * multi-member compile under the identical widest-common-root convention.
 */
export function commonAncestor(a: string, b: string): string {
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
 *
 * @param sourceId the member's `sourceId` (FR-012/FR-013 attribution): a
 *   failed segment fetch is re-thrown naming BOTH the member and the failing
 *   segment/folio, so batch + standalone callers can pin which member broke
 *   without having to infer it from an underlying `ImageByteSource` error
 *   that only names the folio.
 */
async function stageMemberSegments(
  imageSource: ImageByteSource,
  segments: MemberPageMasterSegment[],
  imageDir: string,
  sourceId: string,
): Promise<TypstVersoSegment[]> {
  const staged: TypstVersoSegment[] = [];
  for (const segment of segments) {
    let fetched;
    try {
      fetched = await imageSource.fetch({
        folioId: segment.folioId,
        // Archive-direct members carry no per-segment ark (mirrors build.ts's
        // archive-direct pages -- see `stageImages`'s doc).
        ark: null,
        objectStoreKey: segment.objectStoreKey,
        sha256: segment.sha256,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `stageMemberSegments: member "${sourceId}" segment "${segment.folioId}" image fetch ` +
          `failed -- ${message}`,
      );
    }
    const ext = detectImageExt(fetched.bytesPath, segment.folioId);
    const fileName = versoName(segment.folioId, ext);
    copyFileSync(fetched.bytesPath, path.join(imageDir, fileName));
    staged.push({ imagePath: fileName, sha256: fetched.sha256 });
  }
  return staged;
}

/**
 * Everything {@link composeMemberPage} needs to compose one member's page,
 * independent of where its output ultimately lands: a standalone member PDF
 * (`buildMemberItem`, this module) or one section of a group edition
 * (`@/pdf/render/group-edition`'s `buildGroupEdition`, spec 017 T011).
 */
export interface ComposeMemberPageContext {
  /** The private archive root the member's folios/issue.txt live under. */
  archiveRoot: string;
  /** Fetches the member's detached `ocr-text` asset bytes (`materializeIssueText`, T005). */
  objectStore: ObjectStore;
  /** The resolved image-byte source (`makeImageSource`) segment bytes are fetched through. */
  imageSource: ImageByteSource;
  /** Reads the pinned archive ref for the colophon (`makeArchivePinReader`). */
  pin: ArchivePinReader;
  /**
   * Absolute directory this member's staged segment images are written into.
   * A standalone member build stages directly into its own `<sourceId>.images`
   * dir; a group edition stages into a per-member-namespaced subdirectory of
   * the group's shared image dir (so two members' both-`f001..` filenames
   * never collide) -- see `buildGroupEdition`.
   */
  imageDir: string;
  /**
   * Relative path prefix prepended to every staged segment's `imagePath` in
   * the returned `TypstPage` (NOT to where the bytes are physically written,
   * which is always `imageDir` verbatim). Empty/absent when the Typst
   * compile's own `imageDir` IS this member's `imageDir` (`buildMemberItem`);
   * a group edition sets this to `"<memberId>/"` so each segment resolves
   * under the group compile's single, shared `imageDir` (spec 017 T011).
   */
  imagePathPrefix?: string;
}

/**
 * Compose ONE source-group member's collapsed `TypstPage` -- the whole
 * per-member pipeline (materialize `issue.txt`, assemble front-matter/
 * colophon/segments, fetch + sha256-verify + stage every segment's image
 * bytes) EXCEPT the final one-page `TypstInput` wrap + Typst compile, which
 * differ between a standalone member PDF (`buildMemberItem`, one page, one
 * compile) and a group edition (`buildGroupEdition`, N pages, ONE compile).
 * Both callers share this exact function -- neither clones its logic.
 *
 * @throws Error on any fail-loud violation: no `page-master` assets, a
 *   missing/mismatched `ocr-text` asset (`materializeIssueText`), a failed
 *   image fetch, a sha256 mismatch, or an unresolvable title/rights/date.
 */
export async function composeMemberPage(
  member: MemberWithRecords,
  ctx: ComposeMemberPageContext,
): Promise<{ page: TypstPage; assembly: MemberEditionAssembly }> {
  // 1. Materialize issue.txt from the detached ocr-text asset FIRST (T005) --
  //    before anything else reads it. The whole-article OCR becomes the
  //    single page's recto `english`.
  const issueTxtPath = await materializeIssueText(member, ctx.archiveRoot, ctx.objectStore);
  const englishText = await readFile(issueTxtPath, 'utf-8');

  // 2. Assemble front-matter + colophon + ordered segments (pure data).
  const assembly = await assembleMemberEdition(member, ctx.archiveRoot, ctx.pin);

  // 3. Fetch + sha256-verify + stage every segment's image bytes.
  const stagedSegments = await stageMemberSegments(
    ctx.imageSource,
    assembly.segments,
    ctx.imageDir,
    member.sourceId,
  );

  // Defensive guard (belt-and-suspenders): `collectPageMasterSegments`
  // (`@/pdf/render/member-edition`, called from `assembleMemberEdition` in
  // step 2 above) already throws if the member carries zero `page-master`
  // assets, so `assembly.segments`/`stagedSegments` should never be empty by
  // the time execution reaches here. Guard it explicitly anyway -- an
  // unattributable `TypeError: Cannot read properties of undefined` from a
  // bare `assembly.segments[0]` index below would defeat FR-012's promise
  // that every failure names the member.
  if (assembly.segments.length === 0 || stagedSegments.length === 0) {
    throw new Error(
      `composeMemberPage: member "${member.sourceId}" has no page-master segments -- cannot ` +
        'compose a collapsed page without at least one staged segment image.',
    );
  }

  const prefix = ctx.imagePathPrefix ?? '';
  const versoSegments: TypstVersoSegment[] = stagedSegments.map((segment) => ({
    imagePath: `${prefix}${segment.imagePath}`,
    sha256: segment.sha256,
  }));

  // 4. Collapse into ONE TypstPage: verso.segments carries all N staged
  //    segments (ascending); the required single imagePath/sha256 fields
  //    (unused by the template once segments are present) name the first
  //    segment as the page's primary image. recto.english is the whole
  //    materialized OCR text; ocrFrench is always empty (no French OCR on a
  //    member); machineAssist is always null (no translation is performed).
  const page: TypstPage = {
    pageId: 'p001',
    folioId: assembly.segments[0].folioId,
    verso: {
      imagePath: versoSegments[0].imagePath,
      sha256: versoSegments[0].sha256,
      segments: versoSegments,
    },
    recto: {
      ocrFrench: '',
      english: englishText,
      ocrCondition: assembly.colophon.ocrTranscription?.caveat ?? null,
      machineAssist: null,
    },
  };

  return { page, assembly };
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
  // Deliberately NOT `opts.showFrench ?? config.showFrench`: a source-group
  // member is english-only BY DEFINITION (FR-007 -- no French-OCR |
  // English-translation split for a clipping's detached OCR text), and
  // `composeMemberPage` always hardcodes the recto's `ocrFrench: ''` /
  // `machineAssist: null`. Reading the parallel-FR|EN config default here
  // would (when that default is `true`, its normal value) render the
  // PARALLEL recto template with a blank French column -- a broken member
  // PDF. See `composeMemberPage`'s doc.
  const archiveRoot = resolveArchiveRoot(repoRoot, opts.archiveRoot, env);

  // Stage the per-source build dir + image dir.
  const outRoot = path.isAbsolute(opts.outDir ?? config.outDir)
    ? (opts.outDir ?? config.outDir)
    : path.join(repoRoot, opts.outDir ?? config.outDir);
  const buildDir = path.join(outRoot, member.sourceId);
  const imageDir = path.join(buildDir, `${member.sourceId}.images`);
  rmSync(imageDir, { recursive: true, force: true });
  mkdirSync(imageDir, { recursive: true });

  const fetchFn = resolveFetchFn(opts.fetchFn);
  const imageSource = makeImageSource(provider, fetchFn, env);
  const pin = makeArchivePinReader(config.pinFile);

  const { page, assembly } = await composeMemberPage(member, {
    archiveRoot,
    objectStore: opts.objectStore,
    imageSource,
    pin,
    imageDir,
  });

  const typstInput: TypstInput = {
    itemId: member.sourceId,
    kind: 'monograph',
    titlePage: assembly.titlePage,
    pages: [page],
    colophon: assembly.colophon,
    // Always english-only (FR-007) -- see the comment above on why this is
    // never read from `opts`/config for a member. Unconditional, not merely
    // defaulted, so a caller cannot accidentally opt back into a broken
    // parallel-FR|EN member render.
    showFrench: false,
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
