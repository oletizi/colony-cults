import { describe, expect, it } from 'vitest';

import {
  buildViewRegistry,
  generateAcquisitionTrackerCsv,
  generateSourcesCsv,
} from '@/bibliography/regenerate';
import { parseCsv } from '@/bibliography/csv';
import type { CanonicalModel } from '@/bibliography/model';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/**
 * Unit tests for T020's four view generators (T019, written first). Every
 * fixture model is built in-memory -- no fs, no fixtures on disk -- so these
 * tests exercise `regenerate.ts` as a pure function of `CanonicalModel`,
 * matching contracts/cli.md's determinism requirement (FR-015) and the
 * SC-005/SC-008 guarantees (PB-P001's two copies survive; drift is
 * detectable as a plain string difference).
 */

const GALLICA_SOURCE_ARCHIVE = 'Gallica / BnF';
const SLQ_SOURCE_ARCHIVE = 'State Library of Queensland';

function pbP001Source(): Source {
  return {
    sourceId: 'PB-P001',
    kind: 'periodical',
    case: 'port-breton',
    language: 'French',
    creator: 'Marquis de Rays / colonial enterprise',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
    notes: 'Recruitment and propaganda newspaper for the colony.',
  };
}

function pbP001Records(): RepositoryRecord[] {
  return [
    {
      sourceId: 'PB-P001',
      sourceArchive: GALLICA_SOURCE_ARCHIVE,
      status: 'collecting',
      catalogUrl: 'https://gallica.bnf.fr/ark:/12148/cb328261098/date',
      identifiers: [{ type: 'ark', value: 'ark:/12148/cb328261098/date' }],
    },
    {
      sourceId: 'PB-P001',
      sourceArchive: SLQ_SOURCE_ARCHIVE,
      status: 'to-collect',
      catalogUrl: 'https://onesearch.slq.qld.gov.au/permalink/61SLQ_INST/bumb4u/alma99183978086302061',
    },
  ];
}

function pbS001Source(): Source {
  return {
    sourceId: 'PB-S001',
    kind: 'monograph',
    case: 'port-breton',
    language: 'French',
    creator: 'Daniel Raphalen',
    titles: [{ text: "L'Odyssée de Port-Breton", role: 'canonical' }],
    identifiers: [],
    notes: 'Likely definitive modern French monograph.',
  };
}

/** A two-Source, three-record fixture model (PB-P001's two copies + PB-S001's zero). */
function fixtureModel(): CanonicalModel {
  return {
    sources: [pbP001Source(), pbS001Source()],
    repositoryRecords: pbP001Records(),
    identifierLeaks: [],
  };
}

describe('generateSourcesCsv', () => {
  it('is deterministic: two calls on the same model yield byte-identical output', () => {
    const model = fixtureModel();
    expect(generateSourcesCsv(model)).toBe(generateSourcesCsv(model));
  });

  it('emits one row per Source with the fixed legacy column order, projecting only SSOT-held fields', () => {
    const csv = generateSourcesCsv(fixtureModel());
    const table = parseCsv(csv);
    expect(table.header).toEqual([
      'id',
      'case',
      'title',
      'creator',
      'year',
      'type',
      'language',
      'status',
      'access',
      'public_domain',
      'notes',
    ]);
    expect(table.rows).toHaveLength(2);
    const p001 = table.rows.find((row) => row.id === 'PB-P001');
    expect(p001).toBeDefined();
    expect(p001?.title).toBe('La Nouvelle France');
    expect(p001?.creator).toBe('Marquis de Rays / colonial enterprise');
    expect(p001?.case).toBe('port-breton');
    // `type` projects the SSOT `kind` (periodical/monograph) -- keeps sources.csv
    // migrate-consumable (detectKind reads it) and is not fabricated data.
    expect(p001?.type).toBe('periodical');
    // Not discrete SSOT fields (folded into notes / dropped by migrate) -- never fabricated.
    expect(p001?.year).toBe('');
    expect(p001?.status).toBe('');
    expect(p001?.access).toBe('');
    expect(p001?.public_domain).toBe('');
  });

  it('a regenerated view differs from a hand-mutated committed copy (the view-drift signal)', () => {
    const original = generateSourcesCsv(fixtureModel());
    const mutated = original.replace('La Nouvelle France', 'La Nouvelle France (hand-edited)');
    expect(mutated).not.toBe(original);
    // Re-regenerating from the SAME (unmutated) model reproduces the original exactly.
    expect(generateSourcesCsv(fixtureModel())).toBe(original);
  });

  it('SC-003: a title edit in the SSOT model propagates to the regenerated view with no other change', () => {
    const before = generateSourcesCsv(fixtureModel());

    const editedModel = fixtureModel();
    editedModel.sources[0].titles[0].text = 'La Nouvelle France (revised title)';
    const after = generateSourcesCsv(editedModel);

    expect(after).not.toBe(before);
    expect(parseCsv(after).rows.find((row) => row.id === 'PB-P001')?.title).toBe(
      'La Nouvelle France (revised title)',
    );
  });
});

describe('generateAcquisitionTrackerCsv', () => {
  it('is deterministic', () => {
    const model = fixtureModel();
    expect(generateAcquisitionTrackerCsv(model)).toBe(generateAcquisitionTrackerCsv(model));
  });

  it('joins a Source\'s repositoryRecords\' archives into vendor_or_archive', () => {
    const table = parseCsv(generateAcquisitionTrackerCsv(fixtureModel()));
    const p001 = table.rows.find((row) => row.id === 'PB-P001');
    expect(p001?.vendor_or_archive).toBe(`${GALLICA_SOURCE_ARCHIVE} / ${SLQ_SOURCE_ARCHIVE}`);
    const s001 = table.rows.find((row) => row.id === 'PB-S001');
    expect(s001?.vendor_or_archive).toBe('');
  });
});

/** A zero-member `source-group` Source (specs/005-source-groups/research.md R-002), e.g. PB-P004 post-migration. */
function pbGroupSource(): Source {
  return {
    sourceId: 'PB-P004',
    kind: 'source-group',
    case: 'port-breton',
    titles: [{ text: 'Trial and Sentencing Records', role: 'canonical' }],
    identifiers: [],
  };
}

/** A member stub `partOf` the group -- an ordinary Source, just carrying the edge. */
function pbGroupMemberSource(): Source {
  return {
    sourceId: 'PB-P004-01',
    kind: 'monograph',
    partOf: 'PB-P004',
    case: 'port-breton',
    titles: [{ text: 'Indictment', role: 'canonical' }],
    identifiers: [],
  };
}

/** A model with a zero-repository-record source-group plus one member stub, alongside the base fixture. */
function groupFixtureModel(): CanonicalModel {
  const base = fixtureModel();
  return {
    sources: [...base.sources, pbGroupSource(), pbGroupMemberSource()],
    repositoryRecords: base.repositoryRecords,
    identifierLeaks: [],
  };
}

describe('R-002: source-group tolerance (empty group, no repository records)', () => {
  it('sources.csv emits one row for the group with kind projected and acquisition-shaped columns empty', () => {
    const table = parseCsv(generateSourcesCsv(groupFixtureModel()));
    const group = table.rows.find((row) => row.id === 'PB-P004');
    expect(group).toBeDefined();
    expect(group?.title).toBe('Trial and Sentencing Records');
    expect(group?.type).toBe('source-group');
    expect(group?.case).toBe('port-breton');
    // Acquisition-shaped columns are empty for every Source (group or not) --
    // never fabricated, and there is nothing to acquire for a group.
    expect(group?.status).toBe('');
    expect(group?.access).toBe('');
    expect(group?.public_domain).toBe('');
  });

  it('sources.csv emits the member stub as its own ordinary row', () => {
    const table = parseCsv(generateSourcesCsv(groupFixtureModel()));
    const member = table.rows.find((row) => row.id === 'PB-P004-01');
    expect(member).toBeDefined();
    expect(member?.title).toBe('Indictment');
    expect(member?.type).toBe('monograph');
  });

  it('acquisition-tracker.csv emits NO row for the source-group', () => {
    const table = parseCsv(generateAcquisitionTrackerCsv(groupFixtureModel()));
    expect(table.rows.find((row) => row.id === 'PB-P004')).toBeUndefined();
    // Sanity: the tracker still has rows for the non-group sources (fixture's
    // two plus the member stub), so the filter targets kind, not just "no records".
    expect(table.rows.map((row) => row.id).sort()).toEqual(
      ['PB-P001', 'PB-P004-01', 'PB-S001'].sort(),
    );
  });

  it('acquisition-tracker.csv still gives the member stub its own row with empty acquisition columns (no records yet)', () => {
    const table = parseCsv(generateAcquisitionTrackerCsv(groupFixtureModel()));
    const member = table.rows.find((row) => row.id === 'PB-P004-01');
    expect(member).toBeDefined();
    expect(member?.vendor_or_archive).toBe('');
    expect(member?.status).toBe('');
  });

  it('a group with zero members regenerates deterministically across both views', () => {
    const model = groupFixtureModel();
    expect(generateSourcesCsv(model)).toBe(generateSourcesCsv(model));
    expect(generateAcquisitionTrackerCsv(model)).toBe(generateAcquisitionTrackerCsv(model));
  });
});

describe('buildViewRegistry', () => {
  it('builds exactly the two PUBLIC CSVs -- the archive-side register + stubs are curated migrate input, not generated views', () => {
    const views = buildViewRegistry(fixtureModel());

    expect(views.every((view) => view.kind === 'public')).toBe(true);
    const relativePaths = views.map((view) => view.relativePath);
    expect(relativePaths.sort()).toEqual(
      ['bibliography/acquisition-tracker.csv', 'bibliography/sources.csv'].sort(),
    );
  });

  it('still builds both views for a model with zero repository records', () => {
    const noRecordsModel: CanonicalModel = { sources: [pbS001Source()], repositoryRecords: [], identifierLeaks: [] };
    const views = buildViewRegistry(noRecordsModel);
    expect(views.map((view) => view.relativePath).sort()).toEqual(
      ['bibliography/acquisition-tracker.csv', 'bibliography/sources.csv'].sort(),
    );
  });
});
