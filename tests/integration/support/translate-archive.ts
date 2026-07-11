import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TranslateIssueCtx } from '@/translate/issue';
import type { TranslateSourceCtx } from '@/translate/source';
import type { TranslationEngine } from '@/engine/types';
import { readProvenance, writeProvenance } from '@/archive/provenance';

/**
 * Shared on-disk fixture builder + fake-engine harness for the US1
 * integration tests (T019 happy path, T020 idempotency, T021 guards):
 * `tests/integration/translate-issue.test.ts`,
 * `tests/integration/translate-idempotent.test.ts`, and
 * `tests/integration/translate-guards.test.ts`. Extracted so the tmp-archive
 * setup that drives `translateIssue` against a temp archive laid out exactly
 * as `findIssueDir` expects is written once, not duplicated three times.
 */

// Registered periodical layout for PB-P001 (src/archive/location.ts):
//   port-breton / newspapers / la-nouvelle-france.
export const SOURCE_ID = 'PB-P001';
// Alphanumeric bare ark (passes assertValidArk); the issue dir is named
// `<date>_<bareArk>` so `findIssueDir` matches on the `_<bareArk>` suffix.
export const BARE_ARK = 'bpt6k5603637g';
const ISSUE_DIR_NAME = `1875-01-15_${BARE_ARK}`;
/** Fixed clock timestamp used by {@link fixedClock}'s default. */
export const FIXED_DATE = '2026-07-08T00:00:00.000Z';
/**
 * Default `ctx.model` for {@link buildCtx}/{@link buildSourceCtx} (now
 * required on `TranslateIssueCtx`/`TranslateSourceCtx`). Tests that care
 * about the resolved model pass their own `model` in `overrides`.
 */
export const TEST_MODEL = 'test-model';
/** Page count baked into the shared `issue-sample.txt` fixture (two form-feeds -> 3 chunks). */
const PAGE_COUNT = 3;

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));
}

/** Options for {@link buildFetchedIssue}. */
export interface BuildFetchedIssueOptions {
  /**
   * `rights_status` stamped into every page's companion provenance YAML.
   * Defaults to whatever `tests/fixtures/page-provenance.yml` already
   * carries (`public-domain`); override to `in-copyright` (etc.) to drive
   * the rights-gate refusal path.
   */
  rightsStatus?: string;
}

/** A tmp archive built for one registered, already-fetched-and-OCR'd issue. */
export interface FetchedIssue {
  /** Root of the tmp archive (mkdtemp'd; pass as `ctx.archiveRoot`). */
  archiveRoot: string;
  /** Registered source id the issue was built under. */
  sourceId: string;
  /** Bare issue ark (pass as `translateIssue`'s first argument). */
  issueArk: string;
  /** Absolute path of the issue directory inside the archive. */
  issueDir: string;
  /** Remove the tmp archive. Call from `afterEach`/`finally`. */
  cleanup: () => void;
}

/**
 * Build a tmp archive on disk for the registered source {@link SOURCE_ID},
 * laid out exactly as `findIssueDir` expects: {@link PAGE_COUNT} page images
 * (`f001.jpg`..) each with a companion `.yml` derived from the shared
 * `page-provenance.yml` fixture (rights_status overridable), plus a 3-page
 * `issue.txt` copied verbatim from `issue-sample.txt`. Mirrors the T019
 * happy-path test's original `beforeEach`.
 */
export async function buildFetchedIssue(
  opts: BuildFetchedIssueOptions = {},
): Promise<FetchedIssue> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-translate-'));
  const issueDir = path.join(
    archiveRoot,
    'archive/cases/port-breton/newspapers/la-nouvelle-france',
    ISSUE_DIR_NAME,
  );
  await writeFetchedIssueContents(issueDir, { rightsStatus: opts.rightsStatus });

  return {
    archiveRoot,
    sourceId: SOURCE_ID,
    issueArk: BARE_ARK,
    issueDir,
    cleanup: () => rmSync(archiveRoot, { recursive: true, force: true }),
  };
}

/**
 * Write one fetched-and-OCR'd issue's on-disk contents into `issueDir`
 * (created if absent): {@link PAGE_COUNT} page images (`f001.jpg`..) each with
 * a companion `.yml` derived from the shared `page-provenance.yml` fixture
 * (rights_status overridable), plus an `issue.txt`. Extracted from
 * {@link buildFetchedIssue} so the single-issue and whole-source builders share
 * exactly one on-disk layout definition (no duplication).
 *
 * `issueText` defaults to the verbatim 3-page (two form-feed) `issue-sample.txt`
 * fixture; {@link buildFetchedSource} overrides it with a per-issue variant so
 * a fake engine can key failures on a specific issue's text.
 */
async function writeFetchedIssueContents(
  issueDir: string,
  opts: { rightsStatus?: string; issueText?: string } = {},
): Promise<void> {
  mkdirSync(issueDir, { recursive: true });

  const base = await readProvenance(fixturePath('page-provenance.yml'));
  const pageProvenance =
    opts.rightsStatus === undefined
      ? base
      : { ...base, rights_status: opts.rightsStatus };

  for (let n = 1; n <= PAGE_COUNT; n += 1) {
    const stem = `f${String(n).padStart(3, '0')}`;
    writeFileSync(path.join(issueDir, `${stem}.jpg`), `FAKE-PAGE-${n}`);
    await writeProvenance(path.join(issueDir, `${stem}.yml`), pageProvenance);
  }

  const issueText =
    opts.issueText ?? (await readFile(fixturePath('issue-sample.txt'), 'utf-8'));
  writeFileSync(path.join(issueDir, 'issue.txt'), issueText);
}

/** Options for {@link buildFetchedSource}. */
export interface BuildFetchedSourceOptions {
  /** Number of issues to build under the source (default 3). */
  count?: number;
  /**
   * Per-issue `rights_status` overrides, indexed by discovery position. An
   * entry left `undefined` keeps the fixture's `public-domain`. Shorter than
   * `count` is fine -- unlisted issues keep the default.
   */
  rights?: Array<string | undefined>;
}

/** A tmp archive built for the registered source with N fetched issues. */
export interface FetchedSource {
  /** Root of the tmp archive (mkdtemp'd; pass as `ctx.archiveRoot`). */
  archiveRoot: string;
  /** Registered source id the issues were built under. */
  sourceId: string;
  /**
   * The built issues' bare arks in DISCOVERY order (date-ascending), which is
   * also the order `translateSource` processes them and the order their
   * entries appear in the run report. `issueArks[i]` therefore aligns with
   * `report.issues[i]`.
   */
  issueArks: string[];
  /** Remove the tmp archive. Call from `afterEach`/`finally`. */
  cleanup: () => void;
}

/**
 * Build a tmp archive for {@link SOURCE_ID} with `count` fully-fetched issues,
 * each a distinct valid bare ark under a date-ordered directory name
 * (`1875-01-DD_<ark>`), so `discoverIssueArks` returns them in `issueArks`
 * order. Each issue's `issue.txt` is the shared fixture prefixed with an
 * `ARK-<ark>` marker on its first page, so a fake engine can fail (or not)
 * selectively per issue by matching that ark in the source text.
 */
export async function buildFetchedSource(
  opts: BuildFetchedSourceOptions = {},
): Promise<FetchedSource> {
  const count = opts.count ?? 3;
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-translate-src-'));
  const sourceDir = path.join(
    archiveRoot,
    'archive/cases/port-breton/newspapers/la-nouvelle-france',
  );
  const fixtureText = await readFile(fixturePath('issue-sample.txt'), 'utf-8');

  const issueArks: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // Distinct alphanumeric bare ark (passes assertValidArk); none is a
    // substring of another, so ark-matching in a fake engine is unambiguous.
    const ark = `bpt6ksrc${String(i).padStart(4, '0')}`;
    // Strictly increasing date => directory-name sort == this index order.
    const date = `1875-01-${String(i + 1).padStart(2, '0')}`;
    const issueDir = path.join(sourceDir, `${date}_${ark}`);
    await writeFetchedIssueContents(issueDir, {
      rightsStatus: opts.rights?.[i],
      issueText: `ARK-${ark}\n${fixtureText}`,
    });
    issueArks.push(ark);
  }

  return {
    archiveRoot,
    sourceId: SOURCE_ID,
    issueArks,
    cleanup: () => rmSync(archiveRoot, { recursive: true, force: true }),
  };
}

/** One recorded engine invocation: which pass, and the model it was given. */
export interface EngineCall {
  pass: 'clean' | 'en';
  model: string | undefined;
}

/** Options for {@link fakeClaude}. */
export interface FakeClaudeOptions {
  /**
   * When set, matching calls THROW this error instead of returning text (for
   * the T021 claude-failure guard test), and are NOT recorded in `calls`.
   * Unset (default) means every call succeeds.
   */
  failWith?: Error;
  /** Restrict the failure to one pass; default (unset) fails both. */
  failOn?: 'clean' | 'en';
  /**
   * Restrict the failure to calls whose `sourceText` matches this predicate
   * (e.g. only a specific page's raw/corrected text), so a test can fail
   * exactly one page while the others succeed. Default (unset) fails every
   * matching-pass call.
   */
  failWhen?: (sourceText: string) => boolean;
}

/**
 * Fake engine: the cleanup prompt and the translation prompt are distinct, so
 * we branch on the (translation-only) marker phrase. Wrapping the input makes
 * the corrected-French -> English chain observable: page P becomes CLEAN(P),
 * then the translation pass receives CLEAN(P) and returns EN(CLEAN(P)). Every
 * SUCCESSFUL call records the `model` argument in `calls`, so a test can
 * prove the value sent to the engine matches the value recorded in
 * provenance, and that a fresh spy saw zero calls on a skip.
 */
export function fakeClaude(
  calls: EngineCall[],
  options: FakeClaudeOptions = {},
): TranslationEngine {
  return {
    name: 'claude-code-cli',
    run: async (prompt, sourceText, model) => {
      const pass: EngineCall['pass'] = prompt.includes(
        'Translate the following corrected French',
      )
        ? 'en'
        : 'clean';

      const shouldFail =
        options.failWith !== undefined &&
        (options.failOn === undefined || options.failOn === pass) &&
        (options.failWhen === undefined || options.failWhen(sourceText));
      if (shouldFail) {
        throw options.failWith;
      }

      calls.push({ pass, model });
      return pass === 'en' ? `EN(${sourceText})` : `CLEAN(${sourceText})`;
    },
  };
}

/** A clock thunk that always returns the same instant (deterministic `retrieved` provenance). */
export function fixedClock(iso: string = FIXED_DATE): () => Date {
  return () => new Date(iso);
}

/** Preflight spy: a no-op `ctx.preflight` thunk plus its call count. */
export interface PreflightSpy {
  /** Injectable `ctx.preflight` thunk. */
  preflight: () => Promise<void>;
  /** Mutated in place as `preflight()` runs; read after the call. */
  calls: { n: number };
}

/** A no-op preflight spy recording how many times it fired (T019 contract 1: only when real work happens). */
export function preflightSpy(): PreflightSpy {
  const calls = { n: 0 };
  return {
    preflight: async () => {
      calls.n += 1;
    },
    calls,
  };
}

/** A preflight thunk that always throws, simulating `claude` absent (FR-009). */
export function throwingPreflight(
  message = 'claude: command not found',
): () => Promise<void> {
  return async () => {
    throw new Error(message);
  };
}

/** Bundle returned by {@link buildCtx}: the ctx plus its default spies. */
export interface CtxHarness {
  ctx: TranslateIssueCtx;
  /**
   * Calls recorded by the DEFAULT fake engine. Stays empty if `overrides`
   * supplies its own `engine` (build your own `calls` array alongside a
   * custom `fakeClaude(...)` call in that case).
   */
  calls: EngineCall[];
  /** Count recorded by the DEFAULT preflight spy (empty semantics as above for an overridden `preflight`). */
  preflightCalls: { n: number };
}

/**
 * Build a {@link TranslateIssueCtx} wired to a {@link FetchedIssue}'s archive,
 * with a default (always-succeeding) fake engine, a fixed clock, and a
 * counting preflight spy -- the same shape every US1 integration test needs.
 * Pass `overrides` to swap in a failing engine, a throwing preflight,
 * `force: true`, a pinned `model`, etc.
 */
export function buildCtx(
  fetched: Pick<FetchedIssue, 'archiveRoot' | 'sourceId'>,
  overrides: Partial<TranslateIssueCtx> = {},
): CtxHarness {
  const calls: EngineCall[] = [];
  const spy = preflightSpy();
  const ctx: TranslateIssueCtx = {
    engine: fakeClaude(calls),
    sourceId: fetched.sourceId,
    archiveRoot: fetched.archiveRoot,
    clock: fixedClock(),
    force: false,
    model: TEST_MODEL,
    log: () => {},
    preflight: spy.preflight,
    ...overrides,
  };
  return { ctx, calls, preflightCalls: spy.calls };
}

/** Delay spy: a no-op `ctx.delay` thunk plus its call count (pacing coverage). */
export interface DelaySpy {
  /** Injectable `ctx.delay` thunk. */
  delay: () => Promise<void>;
  /** Mutated in place as `delay()` runs; read after the run. */
  calls: { n: number };
}

/** A no-op delay spy recording how many times it fired (whole-source pacing rule). */
export function delaySpy(): DelaySpy {
  const calls = { n: 0 };
  return {
    delay: async () => {
      calls.n += 1;
    },
    calls,
  };
}

/** Bundle returned by {@link buildSourceCtx}: the ctx plus its default spies. */
export interface SourceCtxHarness {
  ctx: TranslateSourceCtx;
  /** Calls recorded by the DEFAULT fake engine (empty if `overrides.engine` given). */
  calls: EngineCall[];
  /** Count recorded by the DEFAULT preflight spy. */
  preflightCalls: { n: number };
  /** Count recorded by the DEFAULT delay spy. */
  delayCalls: { n: number };
}

/**
 * Build a {@link TranslateSourceCtx} wired to a {@link FetchedSource}'s archive,
 * with a default (always-succeeding) fake engine, a fixed clock, a counting
 * preflight spy, and a counting delay spy -- the shape the whole-source
 * integration tests need. Pass `overrides` to swap in a failing engine,
 * `force: true`, a pinned `model`, etc. `sourceId` is NOT part of the ctx (it
 * is `translateSource`'s first argument), so only `archiveRoot` is read here.
 */
export function buildSourceCtx(
  fetched: Pick<FetchedSource, 'archiveRoot'>,
  overrides: Partial<TranslateSourceCtx> = {},
): SourceCtxHarness {
  const calls: EngineCall[] = [];
  const spy = preflightSpy();
  const dspy = delaySpy();
  const ctx: TranslateSourceCtx = {
    engine: fakeClaude(calls),
    archiveRoot: fetched.archiveRoot,
    clock: fixedClock(),
    force: false,
    model: TEST_MODEL,
    log: () => {},
    preflight: spy.preflight,
    delay: dspy.delay,
    ...overrides,
  };
  return { ctx, calls, preflightCalls: spy.calls, delayCalls: dspy.calls };
}
