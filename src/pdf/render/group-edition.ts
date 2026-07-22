/**
 * The source-group EDITION build orchestrator (spec 017 T011): render every
 * ACQUIRED member of one source-group (`Source.partOf`) as a section of ONE
 * combined PDF -- an edition-level title page + N chronologically-ordered
 * member sections (each collapsed to a single stacked-segment page, spec 017
 * T008) + ONE edition-level colophon, rather than N separate per-member PDFs.
 *
 * A source-group has NO archival object of its own (`@/model/source`'s
 * `Source.kind === 'source-group'` doc): it is never fetchable and carries no
 * `repositoryRecords`. `buildGroupEdition` therefore NEVER calls
 * `resolveArchiveSource`/any archive-object resolution on `groupId` itself --
 * its members are the only source of truth, either supplied directly
 * (`opts.members`, the test-injection seam) or enumerated from the
 * bibliography SSOT via `partOf` (`enumerateGroupMembers`).
 *
 * Each member's page is composed via `@/pdf/render/member-build`'s
 * `composeMemberPage` -- the exact same per-member pipeline `buildMemberItem`
 * uses for a standalone member PDF (materialize `issue.txt`, assemble
 * front-matter/colophon/segments, fetch + sha256-verify + stage every
 * segment's image bytes). This module never reimplements that logic; it only
 * adds group-level concerns: member enumeration + acquired-only filtering,
 * chronological ordering (`orderGroupMembers`), per-member image namespacing
 * (so two members' both-`f001..` filenames never collide under one shared
 * image dir), an edition-level title page, an edition-level colophon, and
 * the single multi-page Typst compile.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveArchiveRoot } from '@/archive/location';
import { authoredToRepositoryRecord } from '@/bibliography/authored-record';
import { loadAllSources, loadSourceFile } from '@/bibliography/load';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { resolvePdfConfig } from '@/pdf/config';
import { makeArchivePinReader } from '@/pdf/load/edition';
import { assembleColophon, type ColophonPageInput } from '@/pdf/load/colophon';
import type { ColophonMeta, TitlePageMeta } from '@/pdf/model';
import {
  commonAncestor,
  composeMemberPage,
  type BuildMemberOptions,
} from '@/pdf/render/member-build';
import type { MemberEditionAssembly, MemberWithRecords } from '@/pdf/render/member-edition';
import {
  FONTS_REL,
  makeImageSource,
  resolveFetchFn,
  TEMPLATE_REL,
  toRootRelative,
  type BuildItemResult,
} from '@/pdf/render/build';
import { serializeTypstInput, type TypstInput, type TypstPage } from '@/pdf/render/typst-input';
import { defaultExecRunner, makeTypstRunner } from '@/pdf/render/typst-runner';

/** Options for {@link buildGroupEdition}: everything `BuildMemberOptions` offers, plus optional injected members. */
export interface BuildGroupOptions extends BuildMemberOptions {
  /**
   * Explicit member list (test-injection seam). When provided (even as an
   * empty array), this is the ONLY source of members -- `groupId` is never
   * used to enumerate the bibliography SSOT. When omitted, members are
   * enumerated via {@link enumerateGroupMembers}.
   */
  members?: ReadonlyArray<MemberWithRecords>;
}

/**
 * Order members chronologically ascending by `articleDate`, breaking ties by
 * `sourceId` ascending (FR-009's deterministic order). Pure: returns a NEW
 * array; never mutates `members`.
 */
export function orderGroupMembers<T extends { sourceId: string; articleDate: string }>(
  members: readonly T[],
): T[] {
  return [...members].sort((a, b) => {
    if (a.articleDate !== b.articleDate) {
      return a.articleDate < b.articleDate ? -1 : 1;
    }
    if (a.sourceId !== b.sourceId) {
      return a.sourceId < b.sourceId ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Enumerate every ACQUIRED member of `groupId` from the bibliography SSOT:
 * every `Source` with `partOf === groupId` that carries at least one
 * `page-master`-role asset (mirrors `@/pdf/render/batch`'s
 * `loadMemberCandidate` acquired-member test). A member with a `partOf` edge
 * but no acquired page-master assets (e.g. a `discovered` stub not yet
 * acquired) is not yet buildable and is silently excluded here -- NOT an
 * error; the caller decides whether an empty result is fatal (see
 * `buildGroupEdition`'s empty-members throw).
 */
function enumerateGroupMembers(groupId: string, bibliographyDir: string): MemberWithRecords[] {
  const members: MemberWithRecords[] = [];
  for (const { source, records } of loadAllSources(bibliographyDir)) {
    if (source.partOf !== groupId) {
      continue;
    }
    const repositoryRecords = records.map((record) => authoredToRepositoryRecord(source.sourceId, record));
    const hasPageMasterAssets = repositoryRecords.some((record) =>
      (record.assets ?? []).some((asset) => asset.role === 'page-master'),
    );
    if (!hasPageMasterAssets) {
      continue;
    }
    members.push({ ...source, repositoryRecords });
  }
  return members;
}

/** The group-level title metadata this module resolves without fetching any archival object. */
interface GroupTitleMeta {
  title: string;
  creator: string | null;
  rights: string | null;
}

/**
 * Resolve the group's own title/creator/rights from its bibliography SSOT
 * entry (`bibliography/sources/<groupId>.yml`), if one exists -- e.g.
 * `PB-P060`'s canonical title "New Zealand newspaper coverage of the Marquis
 * de Rays affair (Papers Past)". A group with no SSOT file on disk (the T010
 * unit-test fixture, which injects members without ever authoring a group
 * bibliography entry) is NOT an error: this is a lookup-miss, mirroring
 * `@/bibliography/load`'s `sourceKind` convention ("dir/file absent" collapses
 * to "unknown", never a throw) -- it falls back to `groupId` itself as the
 * title, with `creator`/`rights` left for the caller to derive from the
 * ordered members instead.
 */
function resolveGroupTitleMeta(groupId: string, bibliographyDir: string): GroupTitleMeta {
  const filePath = path.join(bibliographyDir, `${groupId}.yml`);
  if (!existsSync(filePath)) {
    return { title: groupId, creator: null, rights: null };
  }
  const { source } = loadSourceFile(filePath);
  const canonical = source.titles.find((title) => title.role === 'canonical');
  const chosen = canonical ?? source.titles[0];
  const title = chosen !== undefined && chosen.text.trim().length > 0 ? chosen.text : groupId;
  return {
    title,
    creator: source.creator ?? null,
    rights: source.rights?.status ?? null,
  };
}

/** One ordered member's composed page + assembly, threaded from composition through to ordering + colophon. */
interface ComposedMember {
  sourceId: string;
  articleDate: string;
  page: TypstPage;
  assembly: MemberEditionAssembly;
}

/**
 * Build the edition-level `TitlePageMeta`: title/creator/rights from the
 * group's own SSOT entry when one exists, else derived from the ordered
 * members (rights falls back to the earliest member's own resolved rights --
 * every member of one group shares the same public-domain class determination
 * per the group's `rights.basis`, see `PB-P060.yml`). `date` is the earliest
 * member's date alone, or an inclusive range when members span more than one
 * date -- a date/range is acceptable for a multi-section edition (T011).
 */
function buildGroupTitlePage(
  groupMeta: GroupTitleMeta,
  ordered: readonly ComposedMember[],
): TitlePageMeta {
  const firstDate = ordered[0].articleDate;
  const lastDate = ordered[ordered.length - 1].articleDate;
  const date = firstDate === lastDate ? firstDate : `${firstDate} to ${lastDate}`;
  return {
    title: groupMeta.title,
    creator: groupMeta.creator,
    date,
    rights: groupMeta.rights ?? ordered[0].assembly.titlePage.rights,
    ark: null,
    catalogUrl: null,
  };
}

/**
 * Build the ONE edition-level colophon: the pinned archive ref + a full
 * reproducibility manifest of every member's every staged segment (folioId
 * namespaced `<sourceId>/<folioId>` so rows across members are never
 * ambiguous) + a REPRESENTATIVE member's OCR-transcription disclosure (the
 * earliest, per `research.md`'s "one edition-level colophon... OR a
 * representative") -- not a full disclosure aggregation across every
 * member's own provenance reads, which `assembleMemberEdition` already
 * performed once per member.
 */
function buildGroupColophon(
  groupId: string,
  archiveRef: string,
  ordered: readonly ComposedMember[],
): ColophonMeta {
  const colophonPages: ColophonPageInput[] = ordered.flatMap((member) =>
    member.assembly.segments.map((segment) => ({
      pageId: member.sourceId,
      folioId: `${member.sourceId}/${segment.folioId}`,
      objectStoreKey: segment.objectStoreKey,
      sha256: segment.sha256,
      machineAssist: null,
    })),
  );

  return assembleColophon({
    sourceId: groupId,
    itemId: groupId,
    archiveRef,
    pages: colophonPages,
    readingLanguage: 'english',
    ocrTranscription: ordered[0].assembly.colophon.ocrTranscription,
  });
}

/**
 * Build ONE combined PDF for a source-group: every acquired member rendered
 * as a chronologically-ordered section (each a collapsed stacked-segment
 * page, reusing `composeMemberPage`), one edition-level title page, and one
 * edition-level colophon carrying the pinned archive ref.
 *
 * @param groupId the source-group's id (e.g. `PB-P060`). NEVER resolved as an
 *   archival object -- a source-group has none (see module doc).
 * @throws Error if the resolved member list (injected or enumerated) is
 *   empty -- naming `groupId` -- or any per-member `composeMemberPage`/Typst
 *   compile failure (never caught here; a group edition is one atomic build,
 *   not a record-and-continue batch).
 */
export async function buildGroupEdition(
  groupId: string,
  opts: BuildGroupOptions,
): Promise<BuildItemResult> {
  const env = opts.env ?? process.env;
  const config = resolvePdfConfig(env);
  const repoRoot = resolveRepoRoot();
  const provider = opts.provider ?? config.imageProvider;
  const bibliographyDir = path.join(repoRoot, 'bibliography', 'sources');

  const rawMembers = opts.members ?? enumerateGroupMembers(groupId, bibliographyDir);
  if (rawMembers.length === 0) {
    throw new Error(
      `buildGroupEdition: group ${JSON.stringify(groupId)} has no acquired members -- ` +
        'no Source carries partOf === groupId with at least one "page-master" asset (or an ' +
        'empty "members" array was supplied). A source-group edition requires at least one ' +
        'acquired member to render.',
    );
  }

  const archiveRoot = resolveArchiveRoot(repoRoot, opts.archiveRoot, env);
  const pin = makeArchivePinReader(config.pinFile);
  const fetchFn = resolveFetchFn(opts.fetchFn);
  const imageSource = makeImageSource(provider, fetchFn, env);

  const outRoot = path.isAbsolute(opts.outDir ?? config.outDir)
    ? (opts.outDir ?? config.outDir)
    : path.join(repoRoot, opts.outDir ?? config.outDir);
  const buildDir = path.join(outRoot, groupId);
  const imagesRoot = path.join(buildDir, `${groupId}.images`);
  rmSync(imagesRoot, { recursive: true, force: true });
  mkdirSync(imagesRoot, { recursive: true });

  // Compose every member's page -- reusing `composeMemberPage` verbatim, each
  // staged under its OWN namespaced subdirectory of the shared group image
  // dir so no two members' `f001..` filenames collide.
  const composed: ComposedMember[] = [];
  for (const member of rawMembers) {
    const imageDir = path.join(imagesRoot, member.sourceId);
    mkdirSync(imageDir, { recursive: true });
    const { page, assembly } = await composeMemberPage(member, {
      archiveRoot,
      objectStore: opts.objectStore,
      imageSource,
      pin,
      imageDir,
      imagePathPrefix: `${member.sourceId}/`,
    });
    composed.push({ sourceId: member.sourceId, articleDate: assembly.titlePage.date, page, assembly });
  }

  const ordered = orderGroupMembers(composed);

  const groupMeta = resolveGroupTitleMeta(groupId, bibliographyDir);
  const titlePage = buildGroupTitlePage(groupMeta, ordered);
  const colophon = buildGroupColophon(groupId, pin.read(), ordered);

  const typstInput: TypstInput = {
    itemId: groupId,
    kind: 'monograph',
    titlePage,
    pages: ordered.map((member) => member.page),
    colophon,
    // Always english-only (FR-007), NEVER `opts.showFrench ?? config.showFrench`:
    // a group edition's every page is a source-group member's collapsed page,
    // composed via the exact same `composeMemberPage` `buildMemberItem` uses --
    // that composer always hardcodes the recto's `ocrFrench: ''` /
    // `machineAssist: null`, so reading the parallel-FR|EN config default here
    // (its normal value) would render a broken, blank-French-column edition.
    // See `@/pdf/render/member-build`'s `buildMemberItem`, fixed identically.
    showFrench: false,
  };

  const inputPath = path.join(buildDir, `${groupId}.input.json`);
  writeFileSync(inputPath, serializeTypstInput(typstInput));

  // ONE compile for the whole group edition. `--root` is the common ancestor
  // of the repo root (template/fonts) and the build dir, exactly as
  // `buildMemberItem` sandboxes a standalone member build.
  const outPath = path.join(buildDir, `${groupId}.pdf`);
  const typstRoot = commonAncestor(repoRoot, buildDir);
  const typst = opts.typst ?? makeTypstRunner(defaultExecRunner());
  const result = await typst.compile({
    templatePath: path.join(repoRoot, TEMPLATE_REL),
    inputPath: toRootRelative(typstRoot, inputPath),
    imageDir: toRootRelative(typstRoot, imagesRoot),
    outPath,
    fontPath: path.join(repoRoot, FONTS_REL),
    root: typstRoot,
  });

  return { outPath: result.outPath };
}
