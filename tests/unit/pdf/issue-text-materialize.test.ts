import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import type { Source } from '@/model/source';
import type { RepositoryRecord } from '@/model/repository-record';
import { writeMemberFixture } from './member-fixture';
import { sha256OfBytes } from '@/archive/checksum';
import { materializeIssueText } from '@/archive/issue-text-materialize';

/**
 * A Source with its repositoryRecords, as expected by materializeIssueText.
 */
type SourceWithRecords = Source & { repositoryRecords: RepositoryRecord[] };

describe('materializeIssueText', () => {
  // ---------------------------------------------------------------------------
  // T1: Basic happy path — resolves ocr-text asset, fetches bytes, verifies
  // sha256, writes issue.txt and issue.txt.yml with provenance.
  // ---------------------------------------------------------------------------

  it('resolves ocr-text asset, fetches bytes, verifies checksum, writes issue.txt + issue.txt.yml', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G001',
      sourceId: 'PB-P001',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-15',
      pageCount: 2,
      articleDate: '1879-07-15',
      ocrText: 'The quick brown fox jumps over the lazy dog.',
    });

    try {
      // Wire the fixture's memberSource with repositoryRecords for the asset lookup.
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      const issueTxtPath = await materializeIssueText(
        memberWithRecords,
        fixture.archiveRoot,
        fixture.objectStore,
      );

      // Assert return value is the path to the materialized issue.txt.
      expect(issueTxtPath).toBe(path.join(fixture.sourceDir, 'issue.txt'));

      // Assert issue.txt was written with the correct content.
      const issueTxtContent = await readFile(issueTxtPath, 'utf-8');
      expect(issueTxtContent).toBe('The quick brown fox jumps over the lazy dog.');

      // Assert issue.txt.yml sidecar was written with correct provenance.
      const sidecarPath = path.join(fixture.sourceDir, 'issue.txt.yml');
      const sidecarContent = await readFile(sidecarPath, 'utf-8');
      const sidecarData = parseYaml(sidecarContent) as Record<string, unknown>;

      // Verify provenance sidecar contains the required fields.
      expect(sidecarData.object_store).toBeDefined();
      expect((sidecarData.object_store as Record<string, unknown>).key).toBe(
        fixture.ocrTextObjectStoreKey,
      );
      expect(sidecarData.sha256).toBe(fixture.ocrTextSha256);
      expect(sidecarData.source_representation).toBe('papers-past-text-tab');
    } finally {
      fixture.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // T2: Idempotent — calling materializeIssueText again when issue.txt already
  // exists with IDENTICAL content is a no-op (does not throw, does not rewrite).
  // ---------------------------------------------------------------------------

  it('is idempotent: identical re-write is a no-op (T2 / FR-004)', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G001',
      sourceId: 'PB-P002',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-16',
      pageCount: 2,
      articleDate: '1879-07-16',
      ocrText: 'The quick brown fox jumps over the lazy dog.',
    });

    try {
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      // First call: materialize.
      const issueTxtPath = await materializeIssueText(
        memberWithRecords,
        fixture.archiveRoot,
        fixture.objectStore,
      );
      const firstContent = await readFile(issueTxtPath, 'utf-8');
      const firstStat = await import('node:fs/promises').then((m) =>
        m.stat(issueTxtPath),
      );

      // Second call: should be no-op with identical content.
      await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure mtime would differ if file is rewritten.

      const secondPath = await materializeIssueText(
        memberWithRecords,
        fixture.archiveRoot,
        fixture.objectStore,
      );
      const secondContent = await readFile(secondPath, 'utf-8');
      const secondStat = await import('node:fs/promises').then((m) =>
        m.stat(secondPath),
      );

      // Content should be identical.
      expect(secondContent).toBe(firstContent);
      // Modification time should not have changed (no rewrite).
      expect(secondStat.mtime.getTime()).toBe(firstStat.mtime.getTime());
    } finally {
      fixture.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // T3: Conflicting existing issue.txt — different content makes it THROW
  // (fail loud, never clobber).
  // ---------------------------------------------------------------------------

  it('throws when a conflicting existing issue.txt has different content (T3 / FR-004)', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G001',
      sourceId: 'PB-P003',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-17',
      pageCount: 2,
      articleDate: '1879-07-17',
      ocrText: 'Original OCR text.',
    });

    try {
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      // Write a conflicting (different) issue.txt.
      const { writeFile } = await import('node:fs/promises');
      const issueTxtPath = path.join(fixture.sourceDir, 'issue.txt');
      await writeFile(issueTxtPath, 'Different text content.');

      // Attempt to materialize should throw.
      await expect(
        materializeIssueText(
          memberWithRecords,
          fixture.archiveRoot,
          fixture.objectStore,
        ),
      ).rejects.toThrow(/conflicting|different|clobber|PB-P003/i);
    } finally {
      fixture.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // T4: Missing or ambiguous ocr-text asset — zero or multiple ocr-text assets
  // make it THROW (fail loud, id-naming).
  // ---------------------------------------------------------------------------

  it('throws when ocr-text asset is missing (none present)', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G001',
      sourceId: 'PB-P004',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-18',
      pageCount: 2,
      articleDate: '1879-07-18',
    });

    try {
      // Remove the ocr-text asset from repositoryRecords.
      const recordWithoutOcr = {
        ...fixture.repositoryRecord,
        assets: fixture.repositoryRecord.assets.filter((a) => a.role !== 'ocr-text'),
      };
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [recordWithoutOcr],
      };

      // Attempt to materialize should throw.
      await expect(
        materializeIssueText(
          memberWithRecords,
          fixture.archiveRoot,
          fixture.objectStore,
        ),
      ).rejects.toThrow(/missing|ocr-text|PB-P004/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('throws when ocr-text asset is ambiguous (two present)', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G001',
      sourceId: 'PB-P005',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-19',
      pageCount: 2,
      articleDate: '1879-07-19',
      ocrText: 'First OCR text.',
    });

    try {
      // Add a second ocr-text asset to repositoryRecords.
      const secondOcrAsset = {
        ...fixture.repositoryRecord.assets.find((a) => a.role === 'ocr-text')!,
        objectStoreKey: 'archive/cases/port-breton/la-nouvelle-france-1879-07-19/ocr2.txt',
      };
      const recordWithTwoOcr = {
        ...fixture.repositoryRecord,
        assets: [...fixture.repositoryRecord.assets, secondOcrAsset],
      };
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [recordWithTwoOcr],
      };

      // Attempt to materialize should throw.
      await expect(
        materializeIssueText(
          memberWithRecords,
          fixture.archiveRoot,
          fixture.objectStore,
        ),
      ).rejects.toThrow(/ambiguous|multiple|ocr-text|PB-P005/i);
    } finally {
      fixture.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // T5: Checksum mismatch — fetched bytes' sha256 ≠ asset.checksum makes it
  // THROW (fail loud, id-naming).
  // ---------------------------------------------------------------------------

  it('throws when checksum mismatch: fetched bytes sha256 ≠ asset checksum', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G001',
      sourceId: 'PB-P006',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-20',
      pageCount: 2,
      articleDate: '1879-07-20',
      ocrText: 'Correct text.',
    });

    try {
      // Corrupt the checksum in the asset to simulate a mismatch.
      const recordWithBadChecksum = {
        ...fixture.repositoryRecord,
        assets: fixture.repositoryRecord.assets.map((a) =>
          a.role === 'ocr-text' ? { ...a, checksum: 'deadbeef00000000' } : a,
        ),
      };
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [recordWithBadChecksum],
      };

      // Attempt to materialize should throw.
      await expect(
        materializeIssueText(
          memberWithRecords,
          fixture.archiveRoot,
          fixture.objectStore,
        ),
      ).rejects.toThrow(/checksum|mismatch|sha256|PB-P006/i);
    } finally {
      fixture.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // T6: NO-OP when an inline issue.txt already exists for a source that carries
  // one from acquisition (FR-005: existing monographs untouched).
  // Align this with T2's idempotency; the intent is "never overwrite/alter a
  // pre-existing issue.txt".
  // ---------------------------------------------------------------------------

  it('is NO-OP when an inline issue.txt already exists (FR-005)', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G001',
      sourceId: 'PB-P007',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-21',
      pageCount: 2,
      articleDate: '1879-07-21',
      ocrText: 'OCR text from detached asset.',
    });

    try {
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      // Pre-write an existing issue.txt (simulating an inline/pre-existing file).
      const { writeFile } = await import('node:fs/promises');
      const issueTxtPath = path.join(fixture.sourceDir, 'issue.txt');
      const preexistingContent = 'Pre-existing inline issue text.';
      await writeFile(issueTxtPath, preexistingContent);
      const preStat = await import('node:fs/promises').then((m) =>
        m.stat(issueTxtPath),
      );

      // Call materializeIssueText — it should be a no-op (not overwrite).
      const returnedPath = await materializeIssueText(
        memberWithRecords,
        fixture.archiveRoot,
        fixture.objectStore,
      );

      // Content must remain unchanged (NO-OP, did not fetch/write from detached asset).
      const finalContent = await readFile(issueTxtPath, 'utf-8');
      expect(finalContent).toBe(preexistingContent);

      // Modification time must not have changed (truly a no-op).
      const postStat = await import('node:fs/promises').then((m) =>
        m.stat(returnedPath),
      );
      expect(postStat.mtime.getTime()).toBe(preStat.mtime.getTime());
    } finally {
      fixture.cleanup();
    }
  });
});
