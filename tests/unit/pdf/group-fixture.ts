import { mkdtempSync } from 'node:fs';
import { rmSync } from 'node:fs';
import path from 'node:path';

import type { Source } from '@/model/source';
import { writeMemberFixture, type WriteMemberFixtureResult } from './member-fixture';

/**
 * Options for building a source-group fixture.
 */
export interface WriteGroupFixtureOptions {
  /** Source-group ID, e.g., `PB-G001`. */
  groupId: string;

  /** Case folder name (e.g., `port-breton`). */
  case: string;

  /**
   * Number of member fixtures to create. Defaults to 2.
   * Each member gets a distinct article date (chronologically ordered).
   */
  memberCount?: number;
}

/**
 * Result of a source-group fixture builder.
 */
export interface WriteGroupFixtureResult {
  /**
   * The source-group `Source` with `kind: 'source-group'` and no repositoryRecords.
   * Members are derived from their `partOf` edges.
   */
  groupSource: Source;

  /**
   * Array of member fixture results, in chronological order by articleDate.
   */
  members: WriteMemberFixtureResult[];

  /**
   * Combined cleanup function that calls cleanup on all members and the group.
   */
  cleanup: () => void;
}

/**
 * Build a fixture for a source-group with ≥2 members, each with distinct article dates.
 * Useful for testing chronological ordering, member filtering, and multi-issue rendering.
 *
 * Each member is created via `writeMemberFixture` with:
 * - `groupId` set to the group's ID
 * - `sourceId` auto-generated as `<groupId>-M<N>` (e.g., `PB-G001-M001`)
 * - Distinct `articleDate` in ascending chronological order
 *
 * The group Source carries no repositoryRecords; members reference the group
 * via `partOf`, and a reader derives membership at load time.
 *
 * @param opts Configuration.
 * @returns Group Source, array of member fixtures, and combined cleanup.
 */
export async function writeGroupFixture(
  opts: WriteGroupFixtureOptions,
): Promise<WriteGroupFixtureResult> {
  const memberCount = opts.memberCount ?? 2;
  if (memberCount < 1) {
    throw new Error('writeGroupFixture: memberCount must be >= 1');
  }

  const baseDate = new Date('2026-01-01');
  const members: WriteMemberFixtureResult[] = [];

  // ONE shared archive root for every member -- matches production (one
  // `COLONY_ARCHIVE_ROOT` for every source, never a per-member root); a group
  // build given only one member's `archiveRoot` must find every sibling's
  // folio provenance under it too.
  const groupArchiveRoot = mkdtempSync(path.join('/tmp', 'fixture-group-'));

  try {
    // Create each member with a distinct date in ascending order.
    for (let i = 0; i < memberCount; i++) {
      const memberNum = String(i + 1).padStart(3, '0');
      const sourceId = `${opts.groupId}-M${memberNum}`;
      const memberDate = new Date(baseDate);
      memberDate.setDate(memberDate.getDate() + i * 7); // Each member 7 days apart
      const articleDate = memberDate.toISOString().split('T')[0];

      const slug = `${opts.groupId.toLowerCase()}-${articleDate}`;
      const fixture = await writeMemberFixture({
        groupId: opts.groupId,
        sourceId,
        case: opts.case,
        slug,
        pageCount: 2, // 2 pages per member by default
        // Non-overlapping folio ranges (001/002, 101/102, ...): production
        // never collides on folio number (per-member object-store keys are
        // globally unique), but `makeFixtureFetch` keys purely by trailing
        // `fNNN`, so members must not repeat one here.
        startFolio: i * 100 + 1,
        articleDate,
        ocrText: `OCR for ${sourceId} (${articleDate})`,
        archiveRoot: groupArchiveRoot,
      });

      members.push(fixture);
    }

    // Build the source-group Source.
    const groupSource: Source = {
      sourceId: opts.groupId,
      kind: 'source-group',
      case: opts.case,
      identifiers: [],
      titles: [
        {
          text: opts.groupId,
          role: 'archive',
        },
      ],
    };

    // Each member's own cleanup is a no-op (shared root); remove it here.
    const cleanup = (): void => {
      for (const member of members) {
        member.cleanup();
      }
      try {
        rmSync(groupArchiveRoot, { recursive: true, force: true });
      } catch {
        // Already cleaned or doesn't exist; ignore.
      }
    };

    return {
      groupSource,
      members,
      cleanup,
    };
  } catch (err) {
    // Clean up any created members + the shared root on error.
    for (const member of members) {
      member.cleanup();
    }
    try {
      rmSync(groupArchiveRoot, { recursive: true, force: true });
    } catch {
      // Already cleaned or doesn't exist; ignore.
    }
    throw err;
  }
}
