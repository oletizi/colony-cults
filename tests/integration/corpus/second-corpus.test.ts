import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeArchiveLayoutPolicy } from '@/archive/layout-bootstrap';
import {
  installArchiveLayoutPolicy,
  issueDir,
  monographDir,
  sourceLayout,
} from '@/archive/location';
import { loadAllSources } from '@/bibliography/load';
import { resolveScopeRef, type ScopeResolutionContext } from '@/bibliography/scope';
import { resolveBrowserSources } from '@/browser/config';
import { composeCorpus, corporaRootFor } from '@/cli/composition-root';
import { selectCorpus } from '@/corpus/select';
import { assertCorporaValid, validateCorpora, type InstalledCapabilities } from '@/corpus/validate';
import type { Source } from '@/model/source';
import { allocateMemberId } from '@/sourcegroup/id-alloc';

/**
 * T017 — THE SECOND-CORPUS PROOF (specs/018-corpus-config-seam, User Story 3;
 * FR-011, FR-016, SC-003; contracts/corpus-seam.md INV-5, INV-13, INV-16).
 *
 * The load-bearing question this suite answers: can a SECOND corpus run
 * through the SAME composition path the shipped CLI uses, supplied as FIXTURE
 * DATA ONLY, with zero edits to any core `src/` implementation module?
 *
 * HOW THE ZERO-CORE-EDIT CLAIM IS ENFORCED — by the FIXTURE LAYOUT, not by
 * git-diff introspection (spec.md US3 Independent Test). Everything this file
 * supplies to production code is one of exactly two things:
 *
 *   1. DATA under `tests/fixtures/` — `corpora/synthetic.yml`,
 *      `corpora/synthetic.browser.yml` (the same manifest+profile-beside-it
 *      convention production uses under `corpora/`), and the three
 *      `cases/kelp-cove/SYN000#.yml` Source records (T016); plus temp
 *      directories this suite creates and removes.
 *   2. INJECTED ROOTS — `corporaRoot` and `sourcesDir` passed as parameters
 *      (FR-016) to `composeCorpus` / `composeArchiveLayoutPolicy` /
 *      `resolveBrowserSources` / `validateCorpora`.
 *
 * Every production module is imported AS-IS. If any seam had required a core
 * edit, a monkey-patch, or a corpus-specific special case to see the synthetic
 * corpus, that would be a further coupling point and this file could not have
 * been written without it.
 *
 * THE ONE INJECTION SEAM USED, STATED EXPLICITLY so the boundary between
 * "injected" and "would have needed an edit" stays visible:
 * `installArchiveLayoutPolicy` (§5). It is NOT papering over a module that
 * cannot otherwise see the synthetic corpus — the policy it installs is the
 * one `@/archive/layout-bootstrap`'s `composeArchiveLayoutPolicy` produces
 * from the INJECTED fixture roots, i.e. the real composition, not a hand-built
 * stand-in. Installing it is required only because FR-017's binding constraint
 * makes `sourceLayout(sourceId)` sourceId-only and synchronous (it is reached
 * deep inside the fetcher via `resolveFetchedDir`), so it reads a
 * module-scoped policy rather than taking one as a parameter; the deferred
 * composition it falls back to resolves the PRODUCTION corpora root. The
 * install call is the designed preemption point for exactly this case
 * (`@/archive/layout-resolve`'s doc comment names SC-003).
 * `installSourceFilenamePolicy` is NOT used anywhere here — `loadAllSources`
 * takes the policy as a required parameter (FR-018), so §4 threads the
 * synthetic one straight through.
 *
 * HERMETIC: no network, no `process.env` mutation (env is passed as plain data
 * to the two functions that take it), no dependence on the developer's shell,
 * and every write goes to a `mkdtemp` directory removed in `afterAll`. The
 * committed fixtures are only ever READ.
 */

/** `tests/` — this file lives at `tests/integration/corpus/`. */
const testsRoot = path.resolve(__dirname, '..', '..');
/** The INJECTED corpora root (FR-016): manifest + browser profile, one convention. */
const FIXTURE_CORPORA_ROOT = path.join(testsRoot, 'fixtures', 'corpora');
/** The INJECTED sources dir: the synthetic corpus's case records (T016). */
const FIXTURE_SOURCES_DIR = path.join(testsRoot, 'fixtures', 'cases', 'kelp-cove');

/** The synthetic corpus's id, case id, and namespace — fixture data, not code. */
const CORPUS_ID = 'synthetic';
const CASE_ID = 'kelp-cove';
const SYNTHETIC_SOURCE_IDS = ['SYN0001', 'SYN0002', 'SYN0003'] as const;

/**
 * The RETIRED fifth-seam constant, quoted verbatim from FR-018 purely as a
 * NEGATIVE control (§4). Nothing under `src/` may contain it any more; it
 * exists here only to demonstrate that enumerating the synthetic corpus under
 * it would have returned ZERO records — silently — which is what would have
 * made SC-003 pass vacuously against an empty list.
 */
const RETIRED_SOURCE_FILE_PATTERN = /^PB-[A-Z]?\d{3}\.yml$/;

/**
 * The RETIRED SIXTH constant (FR-019), quoted verbatim as a second negative
 * control (§4). It sat one layer BELOW the fifth seam: even once enumeration
 * reached a synthetic file, `loadSourceFile` would have rejected its id a line
 * later, so INV-16 was unsatisfiable without loosening it to the corpus-
 * neutral shape grammar.
 */
const RETIRED_SOURCE_ID_PATTERN = /^PB-[A-Z]?\d{3}$/;

/** No repository/sourceQuery capability is required by the synthetic manifest. */
const NO_CAPABILITIES: InstalledCapabilities = { repositories: [], sourceQueries: [] };

/**
 * The composition, built exactly as `@/cli/dispatch`'s `runCli` builds it —
 * same function, same option shape, with `corporaRoot` injected at the fixture
 * root instead of resolved to `<repoRoot>/corpora`.
 */
const corpus = composeCorpus({ corporaRoot: FIXTURE_CORPORA_ROOT, cliCorpus: CORPUS_ID });

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'corpus-seam-t017-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A fresh scratch directory seeded with a copy of the committed fixtures. */
function seededSourcesDir(name: string): string {
  const dir = path.join(scratch, name);
  cpSync(FIXTURE_SOURCES_DIR, dir, { recursive: true });
  return dir;
}

describe('seam 1 — selection resolves the synthetic corpus from the injected root (INV-13)', () => {
  it('selects `synthetic` through the CLI composition path, at the fixture root', () => {
    expect(corpus.selected.manifest.id).toBe(CORPUS_ID);
    expect(corpus.selected.corporaRoot).toBe(FIXTURE_CORPORA_ROOT);
    expect(corpus.selected.manifest.cases).toEqual([CASE_ID]);
  });

  it('honors the injected root in the dispatcher\'s own root resolution', () => {
    // `corporaRootFor` is what `runCli`/`runTranslateCli` call to decide the
    // root. Injection must win over the production `<repoRoot>/corpora`.
    expect(corporaRootFor({ corporaRoot: FIXTURE_CORPORA_ROOT })).toBe(FIXTURE_CORPORA_ROOT);
  });

  it('rejects `port-breton` under this root — no core module smuggles in the production root', () => {
    // The sharpest INV-13 check: if ANY module still reached the production
    // corpora directory, the shipped corpus would resolve here too.
    expect(() => selectCorpus({ corporaRoot: FIXTURE_CORPORA_ROOT, cliCorpus: 'port-breton' })).toThrow(
      /unknown corpus "port-breton"/,
    );
    expect(() => selectCorpus({ corporaRoot: FIXTURE_CORPORA_ROOT, cliCorpus: 'port-breton' })).toThrow(
      path.join(FIXTURE_CORPORA_ROOT, 'port-breton.yml'),
    );
  });
});

describe('seam 2 — scope resolution uses the synthetic corpus\'s cases (INV-1, FR-004)', () => {
  const sources = (): Source[] =>
    loadAllSources(FIXTURE_SOURCES_DIR, corpus.sourceFilenames).map((loaded) => loaded.source);

  const context = (): ScopeResolutionContext => ({
    sources: sources(),
    threadIds: new Set<string>(),
    validCaseIds: corpus.scope.validCaseIds,
  });

  it('derives validCaseIds = {kelp-cove}, and nothing else', () => {
    expect([...corpus.scope.validCaseIds]).toEqual([CASE_ID]);
    expect(corpus.scope.validCaseIds.size).toBe(1);
  });

  it('accepts a kelp-cove case ref', () => {
    expect(resolveScopeRef({ kind: 'case', id: CASE_ID }, context())).toEqual({
      ref: { kind: 'case', id: CASE_ID },
    });
  });

  it('REJECTS a port-breton case ref — the retired constant is gone, not relocated', () => {
    expect(() => resolveScopeRef({ kind: 'case', id: 'port-breton' }, context())).toThrow(
      /case ref id "port-breton" is not a valid case id for this corpus/,
    );
    // The error enumerates THIS corpus's cases, proving the injected set is
    // what was consulted rather than a wider ambient one.
    expect(() => resolveScopeRef({ kind: 'case', id: 'port-breton' }, context())).toThrow(
      /valid ids: kelp-cove/,
    );
  });

  it('resolves work / work-bundle refs against the synthetic corpus\'s own Sources', () => {
    const resolved = resolveScopeRef({ kind: 'work', id: 'SYN0003' }, context());
    expect(resolved.source?.sourceId).toBe('SYN0003');
    expect(resolved.source?.case).toBe(CASE_ID);
    // SYN0002 is a periodical, not a source-group, so a work-bundle ref to it
    // is a kind/referent mismatch — checked, never assumed.
    expect(() => resolveScopeRef({ kind: 'work-bundle', id: 'SYN0002' }, context())).toThrow(
      /work-bundle ref id "SYN0002" resolves to a Source of kind "periodical"/,
    );
    expect(() => resolveScopeRef({ kind: 'work', id: 'PB-P001' }, context())).toThrow(
      /resolves to no Source in the corpus/,
    );
  });
});

describe('seam 3 — id allocation uses the synthetic prefix AND pad width (US3 AS2, FR-002a)', () => {
  it('derives {prefix: SYN, padWidth: 4} — not PB-P/3', () => {
    expect(corpus.sourceIds).toEqual({ prefix: 'SYN', padWidth: 4 });
  });

  it('allocates SYN0001 (four digits, not three) into an empty namespace', async () => {
    const dir = path.join(scratch, 'alloc-empty');
    mkdirSync(dir);
    const allocated = await allocateMemberId(dir, corpus.sourceIds, 'sourceId: placeholder\n');
    // Pad width is the point: a padWidth-3 policy would have produced SYN001.
    expect(allocated).toBe('SYN0001');
    expect(allocated).toMatch(/^SYN\d{4}$/);
    expect(existsSync(path.join(dir, 'SYN0001.yml'))).toBe(true);
  });

  it('allocates SYN0004 next, and is blind to a co-resident PB-P / PB-S namespace', async () => {
    const dir = seededSourcesDir('alloc-seeded');
    // Decoys from the SHIPPED namespaces, in the same directory. A globally
    // unique id space means the allocator must neither collide with them nor
    // count them.
    writeFileSync(path.join(dir, 'PB-P092.yml'), 'sourceId: PB-P092\n');
    writeFileSync(path.join(dir, 'PB-S002.yml'), 'sourceId: PB-S002\n');

    const allocated = await allocateMemberId(dir, corpus.sourceIds, 'sourceId: placeholder\n');

    expect(allocated).toBe('SYN0004');
    expect(allocated).toMatch(/^SYN\d{4}$/);
    expect(allocated.startsWith('PB-')).toBe(false);
    expect(existsSync(path.join(dir, 'SYN0004.yml'))).toBe(true);
    // The decoys are untouched — allocation claimed a genuinely free id.
    expect(existsSync(path.join(dir, 'PB-P092.yml'))).toBe(true);
  });

  it('has a namespace provably disjoint from the shipped prefixes (leading-substring rule)', () => {
    for (const shipped of ['PB-P', 'PB-S']) {
      expect(shipped.startsWith(corpus.sourceIds.prefix)).toBe(false);
      expect(corpus.sourceIds.prefix.startsWith(shipped)).toBe(false);
    }
  });
});

describe('seam 4 — source enumeration sees all three SYN records (INV-16, FR-018)', () => {
  it('enumerates SYN0001..SYN0003 under the corpus\'s own filename policy', () => {
    const loaded = loadAllSources(FIXTURE_SOURCES_DIR, corpus.sourceFilenames);
    expect(loaded.map((entry) => entry.source.sourceId)).toEqual([...SYNTHETIC_SOURCE_IDS]);
    expect(loaded.map((entry) => entry.source.kind)).toEqual([
      'monograph',
      'periodical',
      'archival-item',
    ]);
  });

  it('honors the pad width: SYN0001.yml matches, SYN001.yml does not', () => {
    expect(corpus.sourceFilenames.isSourceFile('SYN0001.yml')).toBe(true);
    expect(corpus.sourceFilenames.isSourceFile('SYN001.yml')).toBe(false);
    expect(corpus.sourceFilenames.isSourceFile('PB-P001.yml')).toBe(false);
    expect(corpus.sourceFilenames.describe()).toBe('SYN0000.yml');
  });

  it('NEGATIVE CONTROL: the retired hardcoded pattern would have matched zero of them', () => {
    // This is what made the fifth seam load-bearing: under
    // `SOURCE_FILE_PATTERN` the enumeration above returns [] with NO error, so
    // every downstream assertion would pass vacuously against an empty list.
    const filenames = readdirSync(FIXTURE_SOURCES_DIR);
    expect(filenames.length).toBeGreaterThan(0);
    expect(filenames.filter((name) => RETIRED_SOURCE_FILE_PATTERN.test(name))).toEqual([]);
  });

  it('NEGATIVE CONTROL: the retired id pattern would have rejected every SYN id', () => {
    // Proof the SIXTH constant (FR-019) is genuinely gone too: `loadSourceFile`
    // parsed all three ids above, which the retired rule would have failed one
    // layer below enumeration.
    for (const sourceId of SYNTHETIC_SOURCE_IDS) {
      expect(RETIRED_SOURCE_ID_PATTERN.test(sourceId)).toBe(false);
    }
  });
});

describe('seam 5 — archive layouts derive from the synthetic corpus (FR-017, INV-14)', () => {
  /**
   * The policy composed by the REAL bootstrap (`composeArchiveLayoutPolicy`)
   * from the two INJECTED roots — not a hand-built stand-in. See this file's
   * header for why installing it is the designed seam rather than a
   * work-around.
   */
  function installFrom(sourcesDir: string): void {
    installArchiveLayoutPolicy(composeArchiveLayoutPolicy({
      corporaRoot: FIXTURE_CORPORA_ROOT,
      sourcesDir,
    }));
  }

  it('precomputes a derivation for each synthetic Source, and no overrides', () => {
    const policy = composeArchiveLayoutPolicy({
      corporaRoot: FIXTURE_CORPORA_ROOT,
      sourcesDir: FIXTURE_SOURCES_DIR,
    });
    expect([...policy.derived.keys()].sort()).toEqual([...SYNTHETIC_SOURCE_IDS]);
    expect(policy.overrides.size).toBe(0);
  });

  it('resolves layouts under cases/kelp-cove, never under port-breton', () => {
    installFrom(FIXTURE_SOURCES_DIR);

    expect(sourceLayout('SYN0001')).toEqual({
      case: CASE_ID,
      type: 'books',
      slug: 'a-wholly-invented-treatise-on-the-kelp-cove-settlement',
      kind: 'monograph',
    });
    expect(sourceLayout('SYN0002')).toEqual({
      case: CASE_ID,
      type: 'newspapers',
      slug: 'the-kelp-cove-gazette-invented',
      kind: 'periodical',
    });
    for (const sourceId of SYNTHETIC_SOURCE_IDS) {
      expect(sourceLayout(sourceId).case).toBe(CASE_ID);
      expect(sourceLayout(sourceId).case).not.toBe('port-breton');
    }
  });

  it('builds real archive paths under the synthetic case', () => {
    installFrom(FIXTURE_SOURCES_DIR);
    const archiveRoot = path.join(scratch, 'archive-root');

    const monograph = monographDir('SYN0001', archiveRoot);
    expect(monograph).toContain(path.join('archive', 'cases', CASE_ID, 'books'));
    expect(monograph).not.toContain('port-breton');

    const issue = issueDir('SYN0002', { ark: 'bpt6kinvented', date: '1884-05-01' }, archiveRoot);
    expect(issue).toContain(path.join('archive', 'cases', CASE_ID, 'newspapers'));
    expect(issue).toContain('1884-05-01_bpt6kinvented');

    // The resolved `kind` is a resolution STRATEGY read off the synthetic
    // corpus's own data: SYN0002 is a standalone periodical, so the flat
    // monograph path is refused for it.
    expect(() => monographDir('SYN0002', archiveRoot)).toThrow(
      /is registered as kind "periodical", not "monograph"/,
    );
  });

  it('a source-group CONTAINER still throws — no phantom layout (T024, FR-017 step 4)', () => {
    const dir = seededSourcesDir('layout-with-group');
    writeFileSync(
      path.join(dir, 'SYN0009.yml'),
      [
        'sourceId: SYN0009',
        'kind: source-group',
        `case: ${CASE_ID}`,
        'titles:',
        '  - text: An Invented Kelp Cove Bundle',
        '    role: canonical',
        '',
      ].join('\n'),
    );

    const policy = composeArchiveLayoutPolicy({
      corporaRoot: FIXTURE_CORPORA_ROOT,
      sourcesDir: dir,
    });
    // The container is enumerated as a Source (so this is not a silent
    // enumeration miss) but is deliberately absent from `derived`.
    expect(loadAllSources(dir, corpus.sourceFilenames).map((e) => e.source.sourceId)).toContain(
      'SYN0009',
    );
    expect(policy.derived.has('SYN0009')).toBe(false);

    installArchiveLayoutPolicy(policy);
    expect(() => sourceLayout('SYN0009')).toThrow(
      /no archive layout registered for source "SYN0009"/,
    );
    // Its non-container siblings still resolve — the filter is targeted.
    expect(sourceLayout('SYN0001').case).toBe(CASE_ID);
  });

  it('an unknown source id throws rather than defaulting (Principle V)', () => {
    installFrom(FIXTURE_SOURCES_DIR);
    expect(() => sourceLayout('SYN9999')).toThrow(/no archive layout registered/);
    expect(() => sourceLayout('PB-P001')).toThrow(/no archive layout registered/);
  });
});

describe('seam 6 — browser defaults come from synthetic.browser.yml (FR-005)', () => {
  it('resolves [SYN0001, SYN0002], not Port Breton\'s list', () => {
    const sources = resolveBrowserSources({
      env: { COLONY_CORPUS: CORPUS_ID },
      corporaRoot: FIXTURE_CORPORA_ROOT,
    });
    expect(sources).toEqual(['SYN0001', 'SYN0002']);
    expect(sources).toHaveLength(2);
    expect(sources.some((id) => id.startsWith('PB-'))).toBe(false);
    // SYN0003 belongs to the corpus but is deliberately NOT a browser default
    // — proving the list is read from the profile, not derived from the case.
    expect(sources).not.toContain('SYN0003');
  });

  it('still lets CORPUS_SOURCES win outright for this corpus', () => {
    expect(
      resolveBrowserSources({
        env: { COLONY_CORPUS: CORPUS_ID, CORPUS_SOURCES: 'SYN0003' },
        corporaRoot: FIXTURE_CORPORA_ROOT,
      }),
    ).toEqual(['SYN0003']);
  });
});

describe('seam 7 — the config gate passes at the fixture root (FR-015, SC-005)', () => {
  it('validateCorpora reports zero findings', () => {
    const result = validateCorpora(FIXTURE_CORPORA_ROOT, FIXTURE_SOURCES_DIR, NO_CAPABILITIES);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('assertCorporaValid does not throw — including with NO capabilities installed', () => {
    // `requiredCapabilities` is empty in the synthetic manifest, so an empty
    // installed set satisfies it (FR-008): a fixture corpus never fabricates a
    // dependency on a real adapter.
    expect(() =>
      assertCorporaValid(FIXTURE_CORPORA_ROOT, FIXTURE_SOURCES_DIR, NO_CAPABILITIES),
    ).not.toThrow();
    expect(corpus.selected.manifest.requiredCapabilities).toEqual({
      repositories: [],
      sourceQueries: [],
    });
  });
});
