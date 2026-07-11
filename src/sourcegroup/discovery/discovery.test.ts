import { describe, it, expect } from 'vitest';
import {
  DiscoveryDispatcher,
  DiscoveryUnavailableError,
  type DiscoveryCandidate,
  type DiscoveryMechanism,
  type DiscoverySearchOptions,
} from '@/sourcegroup/discovery/discovery';

/**
 * A controllable fake mechanism. `available` and `searchCalls` let each test
 * assert both the fail-loud behavior and that no search is attempted when the
 * mechanism is down.
 */
class FakeMechanism implements DiscoveryMechanism {
  readonly endpoint = 'bnf-catalogue-sru' as const;
  searchCalls = 0;

  constructor(
    private readonly available: boolean | (() => Promise<boolean>),
    private readonly results: readonly DiscoveryCandidate[] = [],
  ) {}

  async isAvailable(): Promise<boolean> {
    return typeof this.available === 'function'
      ? this.available()
      : this.available;
  }

  async search(
    _query: string,
    _opts?: DiscoverySearchOptions,
  ): Promise<readonly DiscoveryCandidate[]> {
    this.searchCalls += 1;
    return this.results;
  }
}

describe('DiscoveryDispatcher — fail-loud, no fallback', () => {
  it('throws DiscoveryUnavailableError when the mechanism is unavailable', async () => {
    const mechanism = new FakeMechanism(false);
    const dispatcher = new DiscoveryDispatcher(mechanism);

    await expect(dispatcher.discover('Marquis de Rays')).rejects.toBeInstanceOf(
      DiscoveryUnavailableError,
    );
  });

  it('does NOT attempt a search when the mechanism is unavailable (no fallback)', async () => {
    const mechanism = new FakeMechanism(false);
    const dispatcher = new DiscoveryDispatcher(mechanism);

    await expect(dispatcher.discover('Marquis de Rays')).rejects.toThrow();
    expect(mechanism.searchCalls).toBe(0);
  });

  it('fails loud (does not swallow) when the availability check itself throws', async () => {
    const mechanism = new FakeMechanism(async () => {
      throw new Error('network down');
    });
    const dispatcher = new DiscoveryDispatcher(mechanism);

    await expect(dispatcher.discover('Marquis de Rays')).rejects.toBeInstanceOf(
      DiscoveryUnavailableError,
    );
    expect(mechanism.searchCalls).toBe(0);
  });

  it('names the bound endpoint in the thrown error (single mechanism, no next-in-line)', async () => {
    const mechanism = new FakeMechanism(false);
    const dispatcher = new DiscoveryDispatcher(mechanism);

    await expect(dispatcher.discover('x')).rejects.toMatchObject({
      endpoint: 'bnf-catalogue-sru',
    });
  });

  it('surfaces candidates from the single mechanism when it is available', async () => {
    const candidate: DiscoveryCandidate = {
      identifier: 'ark:/12148/cb123456789',
      titleHint: 'La Nouvelle-France',
      creatorHint: 'Charles Du Breil de Rays',
      dateHint: '1858',
      endpoint: 'bnf-catalogue-sru',
    };
    const mechanism = new FakeMechanism(true, [candidate]);
    const dispatcher = new DiscoveryDispatcher(mechanism);

    const out = await dispatcher.discover('Marquis de Rays');

    expect(out).toEqual([candidate]);
    expect(mechanism.searchCalls).toBe(1);
    expect(dispatcher.endpoint).toBe('bnf-catalogue-sru');
  });
});
