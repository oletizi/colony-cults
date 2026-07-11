/**
 * T018 integration test: route-set coherence with the normalized corpus.
 *
 * The Astro pages under `site/src/pages/**` enumerate their static paths from
 * the same `loadCorpus` result this test loads. Rather than re-run the build,
 * this test reproduces that enumeration and asserts the emitted route set is
 * COHERENT with the corpus (routes contract B-1, B-6, G-2):
 *
 *  - every source has exactly one source-overview route;
 *  - every page has exactly one reading-view route (no duplicates, no gaps);
 *  - every issue's ledger row (its first-page link) targets a real page route;
 *  - within-issue prev/next resolve to real page routes, null only at the ends;
 *  - the route counts equal the loaded corpus counts;
 *  - skipped (not-collected) issues get NO route -- coherence honours the
 *    loader's "skip + report" bucket the other direction.
 *
 * Guarded by {@link hasFixture} so the suite skips cleanly without the archive.
 */

import { describe, it, expect } from 'vitest';

import type { LoadConfig } from '@/browser/config';
import type { CorpusView } from '@/browser/model';
import { loadCorpus } from '@/browser/load/corpus';

import {
  cleanupCopy,
  hasFixture,
  makeCleanArchive,
  makeCorruptedCopy,
  SIBLING_ISSUE_ID,
} from './fixtures';

// --- Route builders: the SAME shapes the Astro pages emit ------------------

/** Reading-view route for one page (`.../pages/[pageId].astro`). */
function pageRoute(sourceId: string, issueId: string, pageId: string): string {
  return `/sources/${sourceId}/issues/${issueId}/pages/${pageId}/`;
}

/** Source-overview route (`sources/[sourceId]/index.astro`). */
function sourceRoute(sourceId: string): string {
  return `/sources/${sourceId}/`;
}

interface EnumeratedRoutes {
  /** One per source (source-overview routes). */
  sourceRoutes: string[];
  /** One per page (reading-view routes), in enumeration order. */
  pageRoutes: string[];
  /** Each issue's first-page link, as the source overview / breadcrumb emit it. */
  issueFirstPageHrefs: string[];
  /** Per-page within-issue neighbour links, as the reading-view route emits them. */
  neighbours: { self: string; prev: string | null; next: string | null }[];
}

function enumerateRoutes(corpus: CorpusView): EnumeratedRoutes {
  const sourceRoutes: string[] = [];
  const pageRoutes: string[] = [];
  const issueFirstPageHrefs: string[] = [];
  const neighbours: EnumeratedRoutes['neighbours'] = [];

  for (const source of corpus.sources) {
    sourceRoutes.push(sourceRoute(source.sourceId));
    for (const issue of source.issues) {
      const firstPage = issue.pages[0];
      expect(firstPage).toBeDefined(); // a loaded issue always carries pages
      issueFirstPageHrefs.push(pageRoute(source.sourceId, issue.issueId, firstPage.pageId));

      issue.pages.forEach((page, index) => {
        const self = pageRoute(source.sourceId, issue.issueId, page.pageId);
        pageRoutes.push(self);
        const prev = index > 0 ? issue.pages[index - 1] : null;
        const next = index < issue.pages.length - 1 ? issue.pages[index + 1] : null;
        neighbours.push({
          self,
          prev: prev ? pageRoute(source.sourceId, issue.issueId, prev.pageId) : null,
          next: next ? pageRoute(source.sourceId, issue.issueId, next.pageId) : null,
        });
      });
    }
  }

  return { sourceRoutes, pageRoutes, issueFirstPageHrefs, neighbours };
}

function configFor(archivePath: string): LoadConfig {
  return { archivePath, snapshotDir: 'site/data', sources: ['PB-P001'], provider: { kind: 'source-iiif' } };
}

describe('route enumeration (integration, PB-P001)', () => {
  it('emits exactly one source-overview route per source', () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    try {
      const { corpus } = loadCorpus(configFor(archive));
      const { sourceRoutes } = enumerateRoutes(corpus);

      expect(sourceRoutes).toHaveLength(corpus.sources.length);
      expect(new Set(sourceRoutes).size).toBe(sourceRoutes.length); // unique
      for (const source of corpus.sources) {
        expect(sourceRoutes).toContain(sourceRoute(source.sourceId));
      }
    } finally {
      cleanupCopy(archive);
    }
  });

  it('gives every page exactly one reading-view route (counts match loadCorpus)', () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    try {
      const { corpus } = loadCorpus(configFor(archive));
      const { pageRoutes } = enumerateRoutes(corpus);

      const totalPages = corpus.sources
        .flatMap((s) => s.issues)
        .reduce((sum, issue) => sum + issue.pages.length, 0);
      const totalByPageCount = corpus.sources
        .flatMap((s) => s.issues)
        .reduce((sum, issue) => sum + issue.pageCount, 0);

      // exactly one route per page, no duplicates, and the two count views agree
      expect(pageRoutes).toHaveLength(totalPages);
      expect(totalPages).toBe(totalByPageCount);
      expect(new Set(pageRoutes).size).toBe(pageRoutes.length);
    } finally {
      cleanupCopy(archive);
    }
  });

  it("targets every issue's first-page link at a real page route", () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    try {
      const { corpus } = loadCorpus(configFor(archive));
      const { pageRoutes, issueFirstPageHrefs } = enumerateRoutes(corpus);
      const pageRouteSet = new Set(pageRoutes);

      const issueCount = corpus.sources.reduce((sum, s) => sum + s.issues.length, 0);
      expect(issueFirstPageHrefs).toHaveLength(issueCount);
      for (const href of issueFirstPageHrefs) {
        expect(pageRouteSet.has(href)).toBe(true);
      }
    } finally {
      cleanupCopy(archive);
    }
  });

  it('resolves within-issue prev/next to real routes, null only at the ends', () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    try {
      const { corpus } = loadCorpus(configFor(archive));
      const { pageRoutes, neighbours } = enumerateRoutes(corpus);
      const pageRouteSet = new Set(pageRoutes);

      for (const { self, prev, next } of neighbours) {
        expect(pageRouteSet.has(self)).toBe(true);
        if (prev !== null) {
          expect(pageRouteSet.has(prev)).toBe(true);
          expect(prev).not.toBe(self);
        }
        if (next !== null) {
          expect(pageRouteSet.has(next)).toBe(true);
          expect(next).not.toBe(self);
        }
      }

      // Each issue chain: first page has no prev, last has no next, and the
      // chain is contiguous (page i's next is page i+1's self).
      for (const source of corpus.sources) {
        for (const issue of source.issues) {
          const chain = issue.pages.map((page) =>
            pageRoute(source.sourceId, issue.issueId, page.pageId)
          );
          const chainNeighbours = chain.map((self) => neighbours.find((n) => n.self === self));
          expect(chainNeighbours[0]?.prev).toBeNull();
          expect(chainNeighbours[chainNeighbours.length - 1]?.next).toBeNull();
          for (let i = 0; i < chain.length - 1; i += 1) {
            expect(chainNeighbours[i]?.next).toBe(chain[i + 1]);
            expect(chainNeighbours[i + 1]?.prev).toBe(chain[i]);
          }
        }
      }
    } finally {
      cleanupCopy(archive);
    }
  });

  it('emits NO route for a skipped (not-collected) issue', () => {
    if (!hasFixture()) {
      return;
    }
    // drop-issue-ocr skips the canonical issue but keeps the complete sibling.
    const archive = makeCorruptedCopy('drop-issue-ocr');
    try {
      const { corpus, skipped } = loadCorpus(configFor(archive));
      const { pageRoutes, issueFirstPageHrefs } = enumerateRoutes(corpus);

      expect(skipped.length).toBeGreaterThan(0);
      const skippedIds = new Set(skipped.map((s) => s.issueId));

      // Only the sibling issue is routed; the skipped issue's slug appears in no
      // page route and in no first-page link (no silent route for a skip).
      const allRoutes = [...pageRoutes, ...issueFirstPageHrefs];
      for (const skippedId of skippedIds) {
        expect(allRoutes.some((r) => r.includes(skippedId))).toBe(false);
      }
      expect(pageRoutes.every((r) => r.includes(SIBLING_ISSUE_ID))).toBe(true);
    } finally {
      cleanupCopy(archive);
    }
  });
});
