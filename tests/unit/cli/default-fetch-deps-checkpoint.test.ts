import { describe, it, expect } from 'vitest';
import { defaultFetchDeps } from '@/cli/fetch-shared';
import type { ParsedArgs } from '@/cli/parse';

/**
 * Proves `defaultFetchDeps`'s `--checkpoint` wiring branches correctly on
 * source kind (`src/archive/location.ts`'s `sourceLayout(...).kind`):
 * - PERIODICAL: `onIssueComplete` wired (per-issue), `onPageStored` stays
 *   undefined -- issues are already bounded, so no page-cadence commit path
 *   is ever constructed for them (no double-commit risk).
 * - MONOGRAPH: both `onIssueComplete` (final flush) AND `onPageStored`
 *   (page-cadence) are wired.
 * - `--checkpoint` absent: neither hook is wired, for either kind.
 *
 * Only inspects which hooks are (not) present -- never invokes them, so no
 * real git/network happens here (that is covered by
 * `archive-checkpoint.test.ts` and `monograph-page-checkpoint-cadence.test.ts`).
 */

const PERIODICAL_SOURCE_ID = 'PB-P001';
const MONOGRAPH_SOURCE_ID = 'PB-P002';

function args(overrides: {
  sourceId: string;
  checkpoint: boolean;
  checkpointEvery?: number;
}): ParsedArgs {
  return {
    command: 'fetch-source',
    positional: ['ark:/12148/bpt6kFAKE00001'],
    flags: {
      dryRun: false,
      force: false,
      verify: false,
      ocr: false,
      objectStore: false,
      checkpoint: overrides.checkpoint,
    },
    options: {
      sourceId: overrides.sourceId,
      slug: undefined,
      archiveRoot: '/tmp/cc-default-fetch-deps-checkpoint-test-archive',
      checkpointEvery: overrides.checkpointEvery,
    },
  };
}

describe('defaultFetchDeps --checkpoint wiring', () => {
  it('periodical: wires onIssueComplete, leaves onPageStored undefined', () => {
    const deps = defaultFetchDeps(
      args({ sourceId: PERIODICAL_SOURCE_ID, checkpoint: true }),
    );
    expect(deps.onIssueComplete).toBeTypeOf('function');
    expect(deps.onPageStored).toBeUndefined();
  });

  it('monograph: wires both onIssueComplete AND onPageStored', () => {
    const deps = defaultFetchDeps(
      args({ sourceId: MONOGRAPH_SOURCE_ID, checkpoint: true }),
    );
    expect(deps.onIssueComplete).toBeTypeOf('function');
    expect(deps.onPageStored).toBeTypeOf('function');
  });

  it('--checkpoint absent: neither hook is wired (periodical)', () => {
    const deps = defaultFetchDeps(
      args({ sourceId: PERIODICAL_SOURCE_ID, checkpoint: false }),
    );
    expect(deps.onIssueComplete).toBeUndefined();
    expect(deps.onPageStored).toBeUndefined();
  });

  it('--checkpoint absent: neither hook is wired (monograph)', () => {
    const deps = defaultFetchDeps(
      args({ sourceId: MONOGRAPH_SOURCE_ID, checkpoint: false }),
    );
    expect(deps.onIssueComplete).toBeUndefined();
    expect(deps.onPageStored).toBeUndefined();
  });

  it('monograph honors --checkpoint-every when constructing onPageStored', () => {
    // Not directly observable from the outside (the cadence counter is a
    // closure), but must not throw for a valid N, and must wire the hook.
    const deps = defaultFetchDeps(
      args({ sourceId: MONOGRAPH_SOURCE_ID, checkpoint: true, checkpointEvery: 25 }),
    );
    expect(deps.onPageStored).toBeTypeOf('function');
  });
});
