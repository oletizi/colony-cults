import { describe, it, expect } from 'vitest';
import type { Source } from '@/model/source';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Rights, RightsAssessment } from '@/model/rights';
import {
  verifyMember,
  type ArkResolver,
  type ExistingMemberRecord,
  type VerifyMemberInput,
} from '@/sourcegroup/verify-member';

/**
 * Tests for `verifyMember` (T016/T017, FR-006-008, D-03/D-04): the shared
 * DETERMINISTIC repository-verification function. Each check is exercised
 * passing and failing INDEPENDENTLY, using an injected ark resolver and an
 * injected set of existing members -- no real network, no fs. The function
 * makes NO research/relevance judgment: there is no `relevance` field on the
 * verdict.
 */

const ARK = 'ark:/12148/bpt6k1234567';

/** An ark resolver that resolves every ark (records live). */
const resolvesLive: ArkResolver = async (ark) => ({ ark });

/** An ark resolver that resolves nothing (dead ark). */
const resolvesDead: ArkResolver = async () => null;

function publicDomainRights(ark: string): Rights {
  return {
    ark,
    status: 'public-domain',
    rawResponse: '<record/>',
    dcRights: ['public domain'],
  };
}

function member(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P100',
    titles: [{ text: 'Le Petit Journal', role: 'canonical' }],
    kind: 'monograph',
    creator: 'Anonyme',
    identifiers: [],
    ...overrides,
  };
}

function record(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'PB-P100',
    sourceArchive: 'Gallica / BnF',
    status: 'wanted',
    identifiers: [{ type: 'ark', value: ARK }],
    rights: publicDomainRights(ARK),
    ...overrides,
  };
}

function input(overrides: Partial<VerifyMemberInput> = {}): VerifyMemberInput {
  return {
    member: member(),
    record: record(),
    resolveArk: resolvesLive,
    existingMembers: [],
    ...overrides,
  };
}

describe('verifyMember', () => {
  it('passes cleanly when every hard check passes (all-passed verdict)', async () => {
    const verdict = await verifyMember(input());

    expect(verdict.result).toBe('passed');
    expect(verdict.checks).toEqual({
      identifierResolved: 'passed',
      rights: 'passed',
      requiredMetadata: 'passed',
      hardDuplicate: 'passed',
      possibleDuplicate: 'passed',
    });
  });

  it('makes NO relevance judgment -- there is no relevance field on the verdict', async () => {
    const verdict = await verifyMember(input());

    expect('relevance' in verdict).toBe(false);
    expect('relevance' in verdict.checks).toBe(false);
    // The verdict's checks are EXACTLY the five deterministic checks.
    expect(Object.keys(verdict.checks).sort()).toEqual(
      [
        'hardDuplicate',
        'identifierResolved',
        'possibleDuplicate',
        'requiredMetadata',
        'rights',
      ].sort(),
    );
  });

  it('fails identifierResolved (and overall) when the ark does not resolve (dead ark)', async () => {
    const verdict = await verifyMember(input({ resolveArk: resolvesDead }));

    expect(verdict.checks.identifierResolved).toBe('failed');
    expect(verdict.result).toBe('failed');
    // Only the resolver failed; the other hard checks are unaffected.
    expect(verdict.checks.rights).toBe('passed');
    expect(verdict.checks.requiredMetadata).toBe('passed');
    expect(verdict.checks.hardDuplicate).toBe('passed');
  });

  it('fails identifierResolved when the record carries no ark at all', async () => {
    const verdict = await verifyMember(
      input({ record: record({ identifiers: [] }) }),
    );

    expect(verdict.checks.identifierResolved).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('fails rights (and overall) when rights are not public-domain', async () => {
    const otherRights: Rights = {
      ark: ARK,
      status: 'other',
      rawResponse: '<record/>',
      dcRights: ['all rights reserved'],
    };
    const verdict = await verifyMember(
      input({ record: record({ rights: otherRights }) }),
    );

    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
    expect(verdict.checks.identifierResolved).toBe('passed');
  });

  it('fails rights when the record has no rights determination at all', async () => {
    const verdict = await verifyMember(
      input({ record: record({ rights: undefined }) }),
    );

    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('fails requiredMetadata (and overall) when a required member field is missing', async () => {
    // Empty titles violates SOURCE_REQUIRED_FIELDS (`titles` must be non-empty).
    const verdict = await verifyMember(
      input({ member: member({ titles: [] }) }),
    );

    expect(verdict.checks.requiredMetadata).toBe('failed');
    expect(verdict.result).toBe('failed');
    expect(verdict.checks.identifierResolved).toBe('passed');
    expect(verdict.checks.rights).toBe('passed');
  });

  it('fails requiredMetadata when a required record field is missing', async () => {
    const verdict = await verifyMember(
      input({ record: record({ status: '' }) }),
    );

    expect(verdict.checks.requiredMetadata).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('flags hardDuplicate (and fails overall) on a same-ark, same-archive collision with another member', async () => {
    const existing: ExistingMemberRecord[] = [
      {
        sourceId: 'PB-P200',
        ark: ARK,
        sourceArchive: 'Gallica / BnF',
        title: 'A completely different title',
        creator: 'Someone Else',
      },
    ];
    const verdict = await verifyMember(input({ existingMembers: existing }));

    expect(verdict.checks.hardDuplicate).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('does NOT flag hardDuplicate when the same ark is at a DIFFERENT archive', async () => {
    const existing: ExistingMemberRecord[] = [
      {
        sourceId: 'PB-P200',
        ark: ARK,
        sourceArchive: 'State Library of Queensland',
      },
    ];
    const verdict = await verifyMember(input({ existingMembers: existing }));

    expect(verdict.checks.hardDuplicate).toBe('passed');
    expect(verdict.result).toBe('passed');
  });

  it('does NOT count the member\'s own record as a hard duplicate of itself', async () => {
    const existing: ExistingMemberRecord[] = [
      {
        sourceId: 'PB-P100', // same member -- self, not a duplicate
        ark: ARK,
        sourceArchive: 'Gallica / BnF',
      },
    ];
    const verdict = await verifyMember(input({ existingMembers: existing }));

    expect(verdict.checks.hardDuplicate).toBe('passed');
  });

  it('flags possibleDuplicate as review-required on matching title/creator with a DIFFERENT ark', async () => {
    const existing: ExistingMemberRecord[] = [
      {
        sourceId: 'PB-P200',
        ark: 'ark:/12148/DIFFERENT9999',
        sourceArchive: 'Gallica / BnF',
        title: 'le petit journal', // same normalized title
        creator: 'anonyme', // same normalized creator
      },
    ];
    const verdict = await verifyMember(input({ existingMembers: existing }));

    expect(verdict.checks.possibleDuplicate).toBe('review-required');
    // A soft/possible duplicate does NOT by itself fail the hard gate.
    expect(verdict.result).toBe('passed');
    expect(verdict.checks.hardDuplicate).toBe('passed');
  });

  it('matches possibleDuplicate on title/creator/date when a date is supplied', async () => {
    const existing: ExistingMemberRecord[] = [
      {
        sourceId: 'PB-P200',
        ark: 'ark:/12148/DIFFERENT9999',
        sourceArchive: 'Gallica / BnF',
        title: 'Le Petit Journal',
        creator: 'Anonyme',
        date: '1889-01-01',
      },
    ];
    const verdict = await verifyMember(
      input({ existingMembers: existing, candidateDate: '1889-01-01' }),
    );

    expect(verdict.checks.possibleDuplicate).toBe('review-required');
    expect(verdict.result).toBe('passed');
  });

  it('does NOT flag possibleDuplicate when the date differs', async () => {
    const existing: ExistingMemberRecord[] = [
      {
        sourceId: 'PB-P200',
        ark: 'ark:/12148/DIFFERENT9999',
        sourceArchive: 'Gallica / BnF',
        title: 'Le Petit Journal',
        creator: 'Anonyme',
        date: '1900-01-01',
      },
    ];
    const verdict = await verifyMember(
      input({ existingMembers: existing, candidateDate: '1889-01-01' }),
    );

    expect(verdict.checks.possibleDuplicate).toBe('passed');
  });

  it('does NOT flag possibleDuplicate when the ark is the SAME (that is a hard duplicate, not a soft one)', async () => {
    const existing: ExistingMemberRecord[] = [
      {
        sourceId: 'PB-P200',
        ark: ARK, // same ark -> handled by hardDuplicate, not possibleDuplicate
        sourceArchive: 'State Library of Queensland',
        title: 'Le Petit Journal',
        creator: 'Anonyme',
      },
    ];
    const verdict = await verifyMember(input({ existingMembers: existing }));

    expect(verdict.checks.possibleDuplicate).toBe('passed');
  });

  it('fails loud on malformed input (missing member)', async () => {
    const bad = { ...input() };
    Reflect.deleteProperty(bad, 'member');

    await expect(verifyMember(bad)).rejects.toThrow(/member/i);
  });

  it('fails loud on malformed input (resolver is missing)', async () => {
    const bad = { ...input() };
    Reflect.deleteProperty(bad, 'resolveArk');

    await expect(verifyMember(bad)).rejects.toThrow(/resolve/i);
  });
});

/**
 * TASK-28: `verifyMember` is adapter-aware -- the two repository-specific
 * checks (`identifierResolved`, `rights`) dispatch by copy-identifier type. A
 * museum member carries an `accession` copy identifier + `sourceUrl` (no ark,
 * no OAIRecord `rights`) and its authoritative rights live on the
 * operator-authored `rightsAssessment`. These tests exercise the museum arm;
 * the Gallica arm above must stay unchanged (no regression).
 */
describe('verifyMember (museum / accession member)', () => {
  const ACCESSION = '2015.0043.0001';
  const SOURCE_URL = 'https://collection.newitalymuseum.au/item/2015.0043.0001';

  /** An ark resolver that MUST NOT be called for an accession record. */
  const resolverThatThrows: ArkResolver = async () => {
    throw new Error('resolveArk must not be called for an accession (museum) record');
  };

  function publicDomainAssessment(): RightsAssessment {
    return {
      rightsStatus: 'public-domain',
      rightsBasis: 'Photograph created before 1955; Australian pre-1969 term.',
      assessedBy: 'operator',
      assessedAt: '2026-07-14T00:00:00.000Z',
    };
  }

  function museumMember(overrides: Partial<Source> = {}): Source {
    return {
      sourceId: 'PB-M100',
      titles: [{ text: 'New Italy settlers, group portrait', role: 'canonical' }],
      kind: 'archival-item',
      creator: 'Unknown',
      identifiers: [],
      ...overrides,
    };
  }

  function museumRecord(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
    return {
      sourceId: 'PB-M100',
      sourceArchive: 'New Italy Museum',
      status: 'wanted',
      identifiers: [{ type: 'accession', value: ACCESSION }],
      sourceUrl: SOURCE_URL,
      rightsAssessment: publicDomainAssessment(),
      ...overrides,
    };
  }

  function museumInput(overrides: Partial<VerifyMemberInput> = {}): VerifyMemberInput {
    return {
      member: museumMember(),
      record: museumRecord(),
      // The ark resolver is injected but must be UNUSED for an accession record.
      resolveArk: resolverThatThrows,
      existingMembers: [],
      ...overrides,
    };
  }

  it('passes every check for an accession member with sourceUrl + public-domain assessment (resolver never called)', async () => {
    const verdict = await verifyMember(museumInput());

    expect(verdict.result).toBe('passed');
    expect(verdict.checks).toEqual({
      identifierResolved: 'passed',
      rights: 'passed',
      requiredMetadata: 'passed',
      hardDuplicate: 'passed',
      possibleDuplicate: 'passed',
    });
  });

  it('fails rights (fail-closed) when the record has NO rightsAssessment at all', async () => {
    const verdict = await verifyMember(
      museumInput({ record: museumRecord({ rightsAssessment: undefined }) }),
    );

    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
    // identifierResolved is independent and still passes.
    expect(verdict.checks.identifierResolved).toBe('passed');
  });

  it('fails rights (fail-closed) when the assessment is restricted', async () => {
    const restricted: RightsAssessment = { ...publicDomainAssessment(), rightsStatus: 'restricted' };
    const verdict = await verifyMember(
      museumInput({ record: museumRecord({ rightsAssessment: restricted }) }),
    );

    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('fails rights (fail-closed) when the assessment is uncertain', async () => {
    const uncertain: RightsAssessment = { ...publicDomainAssessment(), rightsStatus: 'uncertain' };
    const verdict = await verifyMember(
      museumInput({ record: museumRecord({ rightsAssessment: uncertain }) }),
    );

    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('fails identifierResolved when the accession record has no sourceUrl', async () => {
    const verdict = await verifyMember(
      museumInput({ record: museumRecord({ sourceUrl: undefined }) }),
    );

    expect(verdict.checks.identifierResolved).toBe('failed');
    expect(verdict.result).toBe('failed');
    // rights is independent and still passes.
    expect(verdict.checks.rights).toBe('passed');
  });

  it('fails identifierResolved when the sourceUrl is blank', async () => {
    const verdict = await verifyMember(
      museumInput({ record: museumRecord({ sourceUrl: '   ' }) }),
    );

    expect(verdict.checks.identifierResolved).toBe('failed');
  });

  it('fails identifierResolved when the accession identifier value is empty', async () => {
    const verdict = await verifyMember(
      museumInput({ record: museumRecord({ identifiers: [{ type: 'accession', value: '' }] }) }),
    );

    // An empty accession value classifies as "neither supported identifier".
    expect(verdict.checks.identifierResolved).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('fails both repository-specific checks when the record carries NEITHER ark nor accession', async () => {
    const verdict = await verifyMember(
      museumInput({
        record: museumRecord({ identifiers: [], rightsAssessment: undefined }),
        resolveArk: resolvesLive,
      }),
    );

    expect(verdict.checks.identifierResolved).toBe('failed');
    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
  });
});

/**
 * `verifyMember` papers-past arm (specs/015-papers-past-acquisition): a Papers
 * Past member carries a `papers-past` copy identifier (a well-formed article
 * code, no ark, no OAIRecord `rights`) and its authoritative rights live on the
 * operator-authored `rightsAssessment`. Mirrors the museum arm -- the injected
 * ark resolver is UNUSED and `identifierResolved` is a cheap shape check, never
 * a browser/network resolve. The Gallica and museum arms above must stay
 * unchanged (no regression).
 */
describe('verifyMember (papers-past member)', () => {
  const ARTICLE_CODE = 'HNS18840103.2.19.3';

  /** An ark resolver that MUST NOT be called for a papers-past record. */
  const resolverThatThrows: ArkResolver = async () => {
    throw new Error('resolveArk must not be called for a papers-past record');
  };

  function publicDomainAssessment(): RightsAssessment {
    return {
      rightsStatus: 'public-domain',
      rightsBasis: 'Published in New Zealand in 1884; Crown copyright expired.',
      assessedBy: 'operator',
      assessedAt: '2026-07-16T00:00:00.000Z',
    };
  }

  function papersPastMember(overrides: Partial<Source> = {}): Source {
    return {
      sourceId: 'PB-N100',
      titles: [{ text: 'The Marquis de Rays Expedition', role: 'canonical' }],
      kind: 'archival-item',
      creator: 'Unknown',
      identifiers: [],
      ...overrides,
    };
  }

  function papersPastRecord(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
    return {
      sourceId: 'PB-N100',
      sourceArchive: 'Papers Past / National Library of New Zealand',
      status: 'wanted',
      identifiers: [{ type: 'papers-past', value: ARTICLE_CODE }],
      sourceUrl: `https://paperspast.natlib.govt.nz/newspapers/${ARTICLE_CODE}`,
      rightsAssessment: publicDomainAssessment(),
      ...overrides,
    };
  }

  function papersPastInput(overrides: Partial<VerifyMemberInput> = {}): VerifyMemberInput {
    return {
      member: papersPastMember(),
      record: papersPastRecord(),
      // The ark resolver is injected but must be UNUSED for a papers-past record.
      resolveArk: resolverThatThrows,
      existingMembers: [],
      ...overrides,
    };
  }

  it('passes every check for a papers-past member with a well-formed article code + public-domain assessment (resolver never called)', async () => {
    const verdict = await verifyMember(papersPastInput());

    expect(verdict.result).toBe('passed');
    expect(verdict.checks).toEqual({
      identifierResolved: 'passed',
      rights: 'passed',
      requiredMetadata: 'passed',
      hardDuplicate: 'passed',
      possibleDuplicate: 'passed',
    });
  });

  it('fails identifierResolved when the papers-past record carries no identifier at all', async () => {
    const verdict = await verifyMember(
      papersPastInput({ record: papersPastRecord({ identifiers: [], rightsAssessment: undefined }) }),
    );

    expect(verdict.checks.identifierResolved).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('fails identifierResolved when the article code is malformed (wrong shape)', async () => {
    const verdict = await verifyMember(
      papersPastInput({
        record: papersPastRecord({ identifiers: [{ type: 'papers-past', value: 'not-an-article-code' }] }),
      }),
    );

    expect(verdict.checks.identifierResolved).toBe('failed');
    expect(verdict.result).toBe('failed');
    // rights is independent and still passes.
    expect(verdict.checks.rights).toBe('passed');
  });

  it('fails identifierResolved when the papers-past identifier value is empty', async () => {
    const verdict = await verifyMember(
      papersPastInput({ record: papersPastRecord({ identifiers: [{ type: 'papers-past', value: '' }] }) }),
    );

    // An empty value classifies as "neither supported identifier" -> both fail.
    expect(verdict.checks.identifierResolved).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('fails rights (fail-closed) when the record has NO rightsAssessment at all', async () => {
    const verdict = await verifyMember(
      papersPastInput({ record: papersPastRecord({ rightsAssessment: undefined }) }),
    );

    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
    // identifierResolved is independent and still passes.
    expect(verdict.checks.identifierResolved).toBe('passed');
  });

  it('fails rights (fail-closed) when the assessment is restricted', async () => {
    const restricted: RightsAssessment = { ...publicDomainAssessment(), rightsStatus: 'restricted' };
    const verdict = await verifyMember(
      papersPastInput({ record: papersPastRecord({ rightsAssessment: restricted }) }),
    );

    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
  });

  it('fails rights (fail-closed) when the assessment is uncertain', async () => {
    const uncertain: RightsAssessment = { ...publicDomainAssessment(), rightsStatus: 'uncertain' };
    const verdict = await verifyMember(
      papersPastInput({ record: papersPastRecord({ rightsAssessment: uncertain }) }),
    );

    expect(verdict.checks.rights).toBe('failed');
    expect(verdict.result).toBe('failed');
  });
});
