import { describe, expect, it } from 'vitest';
import { ExitNodePolicy } from '@/sourcequery/exit-node-policy';
import { createFakeClock } from '@/sourcequery/clock';
import type { BlockEvidence, ExitNode, HostExitState } from '@/sourcequery/types';
import { FakeTailscaleRunner } from './fakes';

function makeBlockEvidence(overrides: Partial<BlockEvidence> = {}): BlockEvidence {
  return {
    kind: 'status',
    detail: 'HTTP 403',
    evidencePath: '/tmp/block-2026.html',
    capturedAtUtc: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

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

  describe('buildPermissionRequest', () => {
    const proposedNode = makeNode({
      hostname: 'nz-1',
      ip: '100.64.0.9',
      country: 'New Zealand',
    });
    const blockEvidence = makeBlockEvidence();

    it('populates all seven fields, passing through source/blockEvidence/proposedNode/minimalQueryPlan', () => {
      const { policy } = makePolicy([proposedNode]);
      const currentState: HostExitState = { priorExitNode: null };
      const plan = ['https://source.test/search?q=x'];

      const request = policy.buildPermissionRequest({
        source: 'papers-past',
        blockEvidence,
        currentState,
        proposedNode,
        minimalQueryPlan: plan,
      });

      expect(request.source).toBe('papers-past');
      expect(request.blockEvidence).toBe(blockEvidence);
      expect(request.proposedNode).toBe(proposedNode);
      expect(request.minimalQueryPlan).toBe(plan);
      expect(request.currentOrigin).toBeDefined();
      expect(request.switchCommand).toBeDefined();
      expect(request.hostImpactWarning).toBeDefined();
    });

    it("currentOrigin is 'direct' when priorExitNode is null", () => {
      const { policy } = makePolicy([proposedNode]);

      const request = policy.buildPermissionRequest({
        source: 'papers-past',
        blockEvidence,
        currentState: { priorExitNode: null },
        proposedNode,
        minimalQueryPlan: [],
      });

      expect(request.currentOrigin).toBe('direct');
    });

    it('currentOrigin equals the prior exit node when one is set', () => {
      const { policy } = makePolicy([proposedNode]);

      const request = policy.buildPermissionRequest({
        source: 'papers-past',
        blockEvidence,
        currentState: { priorExitNode: 'us-9.example.ts.net' },
        proposedNode,
        minimalQueryPlan: [],
      });

      expect(request.currentOrigin).toBe('us-9.example.ts.net');
    });

    it('switchCommand uses the hostname when present', () => {
      const { policy } = makePolicy([proposedNode]);

      const request = policy.buildPermissionRequest({
        source: 'papers-past',
        blockEvidence,
        currentState: { priorExitNode: null },
        proposedNode,
        minimalQueryPlan: [],
      });

      expect(request.switchCommand).toBe('tailscale set --exit-node=nz-1');
    });

    it('switchCommand falls back to the ip when hostname is empty', () => {
      const noHostname = makeNode({ hostname: '', ip: '100.64.0.42' });
      const { policy } = makePolicy([noHostname]);

      const request = policy.buildPermissionRequest({
        source: 'papers-past',
        blockEvidence,
        currentState: { priorExitNode: null },
        proposedNode: noHostname,
        minimalQueryPlan: [],
      });

      expect(request.switchCommand).toBe('tailscale set --exit-node=100.64.0.42');
    });

    it('hostImpactWarning is non-empty and warns the whole host is rerouted', () => {
      const { policy } = makePolicy([proposedNode]);

      const request = policy.buildPermissionRequest({
        source: 'papers-past',
        blockEvidence,
        currentState: { priorExitNode: null },
        proposedNode,
        minimalQueryPlan: [],
      });

      expect(request.hostImpactWarning.length).toBeGreaterThan(0);
      expect(request.hostImpactWarning.toLowerCase()).toContain('host');
    });
  });
});
