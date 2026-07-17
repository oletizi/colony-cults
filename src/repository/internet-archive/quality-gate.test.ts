/**
 * Tests for {@link enforceQualityGate} / {@link seedProposedRange}
 * (`@/repository/internet-archive/quality-gate`) -- the T029-T031 fail-closed
 * quality-gate seam + range-seed coverage for the Internet Archive
 * acquisition adapter (specs/013-archiveorg-acquisition-path, FR-008 /
 * IA-INV-C).
 *
 * T032's `acquire`-level wiring (the "zero B2 bytes on unsound" invariant)
 * is exercised later, at T025; this file tests the enforce/seed units in
 * isolation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enforceQualityGate, seedProposedRange } from '@/repository/internet-archive/quality-gate';
import { parseScandata } from '@/repository/internet-archive/scandata';
import type { QualityAssessment } from '@/model/quality-assessment';

const SOUND_CHECKSUM = 'a'.repeat(64);

function soundAssessment(overrides: Partial<QualityAssessment> = {}): QualityAssessment {
  return {
    status: 'sound',
    assessedBy: 'operator',
    assessedAt: '2026-07-16T00:00:00.000Z',
    sourceFileChecksum: SOUND_CHECKSUM,
    expectedPageCount: 8,
    observedPageCount: 8,
    approvedLeafRange: { start: 4, end: 8 },
    ...overrides,
  };
}

describe('enforceQualityGate -- T029 fail-closed on non-sound status', () => {
  it('throws when status is "unsound", even with a matching checksum', () => {
    const assessment = soundAssessment({ status: 'unsound' });
    expect(() => enforceQualityGate(assessment, SOUND_CHECKSUM)).toThrow(/unsound/);
  });

  it('does NOT throw (returns void) when status is "sound" and the checksum matches', () => {
    const assessment = soundAssessment();
    expect(enforceQualityGate(assessment, SOUND_CHECKSUM)).toBeUndefined();
  });
});

describe('enforceQualityGate -- T030 checksum re-verification', () => {
  it('throws when a "sound" assessment carries a checksum that does not match the staged file', () => {
    const assessment = soundAssessment({ status: 'sound', sourceFileChecksum: SOUND_CHECKSUM });
    const stagedChecksum = 'b'.repeat(64);
    expect(() => enforceQualityGate(assessment, stagedChecksum)).toThrow(/checksum/i);
  });

  it('does not conflate a checksum mismatch with a status failure in its message', () => {
    const assessment = soundAssessment();
    const stagedChecksum = 'c'.repeat(64);
    expect(() => enforceQualityGate(assessment, stagedChecksum)).not.toThrow(/unsound/);
  });
});

describe('seedProposedRange -- T031 range seed from scandata', () => {
  const fixturesDir = join(
    process.cwd(),
    'src',
    'repository',
    'internet-archive',
    '__fixtures__',
  );
  const fixtureXml = readFileSync(
    join(fixturesDir, 'scandata-nouvellefrancec00groogoog.xml'),
    'utf-8',
  );

  it('excludes the Cover/Title/Color-Card front matter and returns the Normal span', () => {
    const leaves = parseScandata(fixtureXml);
    const seed = seedProposedRange(leaves);
    expect(seed).toEqual({ start: 4, end: 8 });

    // Front matter (leaves 1-3: Cover, Color Card, Title) is outside the seed.
    expect(seed.start).toBeGreaterThan(3);
  });

  it('is only a proposal: an operator-approved range wider than the seed, including a non-Normal leaf, is a valid QualityAssessment', () => {
    const leaves = parseScandata(fixtureXml);
    const seed = seedProposedRange(leaves);

    // The operator widens the approved range to include leaf 3 ("Title"),
    // e.g. because it actually carries a frontispiece the operator wants
    // preserved as reading content. The seed never decides this -- it only
    // proposes; constructing the assessment with the wider range is valid.
    const widerApprovedRange = { start: 3, end: seed.end };
    const assessment = soundAssessment({ approvedLeafRange: widerApprovedRange });

    expect(assessment.approvedLeafRange.start).toBeLessThan(seed.start);
    expect(() => enforceQualityGate(assessment, SOUND_CHECKSUM)).not.toThrow();
  });
});
