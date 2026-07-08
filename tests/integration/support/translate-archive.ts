import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TranslateIssueCtx } from '@/translate/issue';
import type { ClaudeCli } from '@/claude/client';
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

  // 3-page issue.txt (two form-feeds) copied from the fixture.
  const issueText = await readFile(fixturePath('issue-sample.txt'), 'utf-8');
  writeFileSync(path.join(issueDir, 'issue.txt'), issueText);

  return {
    archiveRoot,
    sourceId: SOURCE_ID,
    issueArk: BARE_ARK,
    issueDir,
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
): ClaudeCli {
  return {
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
   * Calls recorded by the DEFAULT fake claude. Stays empty if `overrides`
   * supplies its own `claude` (build your own `calls` array alongside a
   * custom `fakeClaude(...)` call in that case).
   */
  calls: EngineCall[];
  /** Count recorded by the DEFAULT preflight spy (empty semantics as above for an overridden `preflight`). */
  preflightCalls: { n: number };
}

/**
 * Build a {@link TranslateIssueCtx} wired to a {@link FetchedIssue}'s archive,
 * with a default (always-succeeding) fake claude, a fixed clock, and a
 * counting preflight spy -- the same shape every US1 integration test needs.
 * Pass `overrides` to swap in a failing claude, a throwing preflight,
 * `force: true`, a pinned `model`, etc.
 */
export function buildCtx(
  fetched: Pick<FetchedIssue, 'archiveRoot' | 'sourceId'>,
  overrides: Partial<TranslateIssueCtx> = {},
): CtxHarness {
  const calls: EngineCall[] = [];
  const spy = preflightSpy();
  const ctx: TranslateIssueCtx = {
    claude: fakeClaude(calls),
    sourceId: fetched.sourceId,
    archiveRoot: fetched.archiveRoot,
    clock: fixedClock(),
    force: false,
    log: () => {},
    preflight: spy.preflight,
    ...overrides,
  };
  return { ctx, calls, preflightCalls: spy.calls };
}
