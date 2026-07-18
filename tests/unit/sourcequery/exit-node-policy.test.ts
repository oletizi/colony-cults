import { describe, expect, it } from 'vitest';
import { ExitNodePolicy } from '@/sourcequery/exit-node-policy';
import { createFakeClock } from '@/sourcequery/clock';
import type { ExitNode } from '@/sourcequery/types';
import { FakeTailscaleRunner } from './fakes';

function makeNode(overrides: Partial<ExitNode>): ExitNode {
  return {
    ip: '100.64.0.1',
    hostname: 'node-default',
    country: 'New Zealand',
    city: 'Wellington',
    online: true,
    ...overrides,
  };
}

function makePolicy(nodes: ExitNode[], initialCurrentExitNode: string | null = null): {
  policy: ExitNodePolicy;
  runner: FakeTailscaleRunner;
} {
  const runner = new FakeTailscaleRunner(nodes, initialCurrentExitNode);
  const { clock, sleep } = createFakeClock();
  const policy = new ExitNodePolicy({ tailscale: runner, clock, sleep });
  return { policy, runner };
}

describe('ExitNodePolicy', () => {
  describe('enumerate', () => {
    it('returns the fake runner node list', async () => {
      const nodes = [
        makeNode({ hostname: 'nz-1', country: 'New Zealand', online: true }),
        makeNode({ hostname: 'au-1', country: 'Australia', online: false }),
      ];
      const { policy } = makePolicy(nodes);

      await expect(policy.enumerate()).resolves.toEqual(nodes);
    });

    it('returns an empty list when the runner has no nodes', async () => {
      const { policy } = makePolicy([]);

      await expect(policy.enumerate()).resolves.toEqual([]);
    });
  });

  describe('captureCurrentState', () => {
    it('returns the set prior exit node', async () => {
      const { policy } = makePolicy([], 'nz-1.example.ts.net');

      await expect(policy.captureCurrentState()).resolves.toEqual({
        priorExitNode: 'nz-1.example.ts.net',
      });
    });

    it('returns null when there is no prior exit node (direct)', async () => {
      const { policy } = makePolicy([], null);

      await expect(policy.captureCurrentState()).resolves.toEqual({
        priorExitNode: null,
      });
    });
  });

  describe('selectNode', () => {
    it('prefers the online node matching preferredGeo (case-insensitive)', () => {
      const nodes = [
        makeNode({ hostname: 'us-1', country: 'United States', online: true }),
        makeNode({ hostname: 'nz-1', country: 'New Zealand', online: true }),
        makeNode({ hostname: 'nz-2', country: 'new zealand', online: true }),
      ];
      const { policy } = makePolicy(nodes);

      const selected = policy.selectNode(nodes, 'New Zealand');

      expect(selected?.hostname).toBe('nz-1');
    });

    it('matches preferredGeo case-insensitively against a differently-cased query', () => {
      const nodes = [
        makeNode({ hostname: 'nz-1', country: 'New Zealand', online: true }),
      ];
      const { policy } = makePolicy(nodes);

      const selected = policy.selectNode(nodes, 'NEW ZEALAND');

      expect(selected?.hostname).toBe('nz-1');
    });

    it('falls back to the first online node when no geo match exists', () => {
      const nodes = [
        makeNode({ hostname: 'us-1', country: 'United States', online: true }),
        makeNode({ hostname: 'au-1', country: 'Australia', online: true }),
      ];
      const { policy } = makePolicy(nodes);

      const selected = policy.selectNode(nodes, 'New Zealand');

      expect(selected?.hostname).toBe('us-1');
    });

    it('falls back to the first online node when preferredGeo is omitted', () => {
      const nodes = [
        makeNode({ hostname: 'us-1', country: 'United States', online: true }),
        makeNode({ hostname: 'au-1', country: 'Australia', online: true }),
      ];
      const { policy } = makePolicy(nodes);

      const selected = policy.selectNode(nodes);

      expect(selected?.hostname).toBe('us-1');
    });

    it('returns null when there are no online nodes', () => {
      const nodes = [
        makeNode({ hostname: 'us-1', country: 'United States', online: false }),
        makeNode({ hostname: 'au-1', country: 'Australia', online: false }),
      ];
      const { policy } = makePolicy(nodes);

      expect(policy.selectNode(nodes, 'New Zealand')).toBeNull();
      expect(policy.selectNode(nodes)).toBeNull();
    });

    it('returns null when the node list is empty', () => {
      const { policy } = makePolicy([]);

      expect(policy.selectNode([], 'New Zealand')).toBeNull();
      expect(policy.selectNode([])).toBeNull();
    });

    it('never selects an offline node even when it matches preferredGeo', () => {
      const nodes = [
        makeNode({ hostname: 'nz-offline', country: 'New Zealand', online: false }),
        makeNode({ hostname: 'au-online', country: 'Australia', online: true }),
      ];
      const { policy } = makePolicy(nodes);

      const selected = policy.selectNode(nodes, 'New Zealand');

      expect(selected?.hostname).toBe('au-online');
    });
  });
});
