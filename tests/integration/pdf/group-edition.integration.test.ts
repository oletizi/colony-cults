/**
 * Integration test for {@link buildGroupEdition} (spec 017, T013).
 *
 * `tests/unit/pdf/group-edition.test.ts` (T010) already drives a group
 * fixture end-to-end once, but its ordering assertion is a no-op (it never
 * shuffles the injected `members` array, so a passthrough that never called
 * `orderGroupMembers` at all would still pass). This test closes that gap: it
 * builds a group fixture whose members have DISTINCT article dates, hands
 * `buildGroupEdition` those members in a SHUFFLED (non-ascending) order, and
 * asserts the Typst input Typst actually received is:
 *
 *  1. Exactly ONE PDF file on disk, from exactly one compile call.
 *  2. One page per member, in ASCENDING article-date order -- proving
 *     `buildGroupEdition` re-orders its input rather than passing it through.
 *  3. Backed by a SINGLE edition-level colophon (not one per member), whose
 *     image manifest references every member.
 *  4. Fronted by a group title page whose title/date reflect the group as a
 *     whole (earliest..latest date range), not any one member.
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ObjectStore } from '@/archive/object-store';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';
import { buildGroupEdition } from '@/pdf/render/group-edition';
import type { TypstInput, TypstPage } from '@/pdf/render/typst-input';

import { writeGroupFixture } from '../../unit/pdf/member-fixture';
import { fakeTypstRunner, makeFixtureFetch } from '../../unit/pdf/typst-fake';

/**
 * Recompute the article date `writeGroupFixture` assigns to member index `i`
 * -- the SAME formula it uses internally (base date `2026-01-01`, +7 days per
 * index; see `tests/unit/pdf/member-fixture.ts`'s `writeGroupFixture`).
 * `WriteMemberFixtureResult` does not expose `articleDate` directly, so this
 * test derives the expected value independently rather than trusting the
 * fixture's own internal bookkeeping -- a genuine cross-check.
 */
function expectedDateForIndex(i: number): string {
  const baseDate = new Date('2026-01-01');
  const memberDate = new Date(baseDate);
  memberDate.setDate(memberDate.getDate() + i * 7);
  const isoDate = memberDate.toISOString().split('T')[0];
  if (isoDate === undefined) {
    throw new Error(`expectedDateForIndex: failed to derive a date for index ${i}`);
  }
  return isoDate;
}

/**
 * Extract the namespaced member id from one composed group-edition page's
 * lead verso segment (`<memberId>/fNNN.ext`, per `composeMemberPage`'s
 * `imagePathPrefix`). Throws if the page carries no segments -- every
 * group-edition page is a collapsed stacked-segment verso (T008); a page with
 * none is a defect, not a value to paper over.
 */
function memberIdOfPage(page: TypstPage): string {
  const segments = page.verso.segments;
  if (segments === undefined || segments.length === 0) {
    throw new Error(
      `memberIdOfPage: page ${JSON.stringify(page.pageId)} carries no verso.segments -- every ` +
        'group-edition page must be a collapsed stacked-segment verso.',
    );
  }
  const imagePath = segments[0].imagePath;
  const slashIndex = imagePath.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(
      `memberIdOfPage: segment imagePath ${JSON.stringify(imagePath)} is not namespaced as ` +
        '"<memberId>/...".',
    );
  }
  return imagePath.slice(0, slashIndex);
}

describe('buildGroupEdition (integration)', () => {
  it('builds the group fixture end-to-end: one PDF, date-ordered member sections, and one edition-level colophon', async () => {
    const groupId = 'PB-G903';
    const memberCount = 4;

    const fixture = await writeGroupFixture({
      groupId,
      case: 'port-breton',
      memberCount,
    });

    const tempDir = mkdtempSync(path.join('/tmp', 'group-edition-integration-'));

    try {
      // `writeGroupFixture` builds `fixture.members` in ascending article-date
      // order by construction -- capture that as the expected OUTPUT order and
      // the id -> date map, independent of the SHUFFLED order fed as input below.
      const ascendingSourceIds = fixture.members.map((m) => m.memberSource.sourceId);
      const memberIdToDate = new Map<string, string>();
      fixture.members.forEach((m, i) => {
        memberIdToDate.set(m.memberSource.sourceId, expectedDateForIndex(i));
      });

      // Shuffle: a derangement of [0, 1, 2, 3] with no fixed points, distinct
      // from both ascending and descending order -- proves `buildGroupEdition`
      // re-orders its input rather than passing it through.
      const shuffleOrder = [2, 0, 3, 1];
      expect(shuffleOrder).toHaveLength(memberCount);
      expect(shuffleOrder).not.toEqual([0, 1, 2, 3]);

      const injectedMembers: Array<Source & { repositoryRecords: RepositoryRecord[] }> =
        shuffleOrder.map((i) => {
          const member = fixture.members[i];
          if (member === undefined) {
            throw new Error(`shuffleOrder index ${i} is out of range for ${memberCount} members`);
          }
          return { ...member.memberSource, repositoryRecords: [member.repositoryRecord] };
        });

      // Merge every member's imageBytes into one fetch map (non-overlapping
      // folio ranges by construction -- see `writeGroupFixture`'s `startFolio`).
      const combinedImageBytes = new Map<string, Uint8Array>();
      for (const member of fixture.members) {
        for (const [folioId, bytes] of member.imageBytes) {
          combinedImageBytes.set(folioId, bytes);
        }
      }

      // Merge every member's objectStore into one dispatch stub: try each
      // member's own store in turn for a given key.
      const combinedObjectStore: ObjectStore = {
        async head() {
          return { exists: true, sha256: '' };
        },
        async put() {
          // no-op
        },
        async get(key: string) {
          for (const member of fixture.members) {
            try {
              return await member.objectStore.get(key);
            } catch {
              // This member doesn't carry this key; try the next.
            }
          }
          throw new Error(`Unexpected object-store key in group fixture: ${key}`);
        },
        async attachSha256Metadata() {
          // no-op
        },
      };

      const { runner, calls } = fakeTypstRunner();

      const result = await buildGroupEdition(fixture.groupSource.sourceId, {
        members: injectedMembers,
        archiveRoot: fixture.members[0].archiveRoot,
        objectStore: combinedObjectStore,
        fetchFn: makeFixtureFetch(combinedImageBytes),
        typst: runner,
        outDir: tempDir,
        showFrench: false,
        provider: 'b2',
        env: { ...process.env, CORPUS_CDN_BASE: 'https://cdn.example.com' },
      });

      // --- 1. Exactly one PDF file on disk, from exactly one compile call. ---
      expect(calls).toHaveLength(1);
      expect(result.outPath).toBe(calls[0].outPath);
      expect(existsSync(result.outPath)).toBe(true);
      expect(statSync(result.outPath).isFile()).toBe(true);

      const inputJson = await readFile(calls[0].inputPath, 'utf-8');
      const input: TypstInput = JSON.parse(inputJson);

      // --- 2. One page per member, in ASCENDING article-date order. ---
      expect(input.pages).toHaveLength(memberCount);

      const pageMemberIds = input.pages.map(memberIdOfPage);

      // Every member appears exactly once.
      expect(new Set(pageMemberIds).size).toBe(memberCount);
      for (const sourceId of ascendingSourceIds) {
        expect(pageMemberIds).toContain(sourceId);
      }

      // The page sequence matches the fixture's ascending-date construction
      // order, NOT the shuffled input order -- the core T013 assertion.
      const shuffledSourceIds = shuffleOrder.map((i) => {
        const member = fixture.members[i];
        if (member === undefined) {
          throw new Error(`shuffleOrder index ${i} is out of range for ${memberCount} members`);
        }
        return member.memberSource.sourceId;
      });
      expect(pageMemberIds).toEqual(ascendingSourceIds);
      expect(pageMemberIds).not.toEqual(shuffledSourceIds);

      // Cross-check against the independently-derived date map: every
      // consecutive pair is STRICTLY ascending by date.
      for (let i = 0; i < pageMemberIds.length - 1; i += 1) {
        const currentId = pageMemberIds[i];
        const nextId = pageMemberIds[i + 1];
        const currentDate = memberIdToDate.get(currentId);
        const nextDate = memberIdToDate.get(nextId);
        if (currentDate === undefined || nextDate === undefined) {
          throw new Error(`Missing expected date for member id ${currentId} or ${nextId}`);
        }
        expect(currentDate < nextDate).toBe(true);
      }

      // --- 3. Single edition-level colophon, not one per member. ---
      expect(input.colophon).toBeDefined();
      expect(input.colophon).not.toBeNull();
      expect(Array.isArray(input.colophon)).toBe(false);
      expect(typeof input.colophon).toBe('object');
      // No per-member colophon pages inflated `input.pages` beyond memberCount
      // (already asserted above), and there is exactly one `colophon` field on
      // `TypstInput` (the type itself guarantees singularity; this is the
      // runtime cross-check against the ACTUAL parsed JSON).

      // The single colophon's image manifest references every member (each
      // row's folioId is namespaced `<memberId>/<folioId>`, per
      // `buildGroupColophon`).
      const colophonMemberIds = new Set(input.colophon.images.map((img) => img.folioId.split('/')[0]));
      expect(colophonMemberIds.size).toBe(memberCount);
      for (const sourceId of ascendingSourceIds) {
        expect(colophonMemberIds.has(sourceId)).toBe(true);
      }

      // --- 4. (Optional) group title page reflects the group, not one member. ---
      // No `bibliography/sources/PB-G903.yml` SSOT entry exists on disk, so
      // `resolveGroupTitleMeta` falls back to the group id itself as the title.
      expect(input.titlePage.title).toBe(groupId);

      const firstDate = memberIdToDate.get(ascendingSourceIds[0]);
      const lastDate = memberIdToDate.get(ascendingSourceIds[ascendingSourceIds.length - 1]);
      if (firstDate === undefined || lastDate === undefined) {
        throw new Error('Missing expected first/last date for the group title page range');
      }
      expect(input.titlePage.date).toBe(`${firstDate} to ${lastDate}`);
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
