import { describe, expect, it } from 'vitest';
import { ExitNodePolicy } from '@/sourcequery/exit-node-policy';
import { createFakeClock } from '@/sourcequery/clock';
import type {
  BlockEvidence,
  ExitNode,
  GraceWindowConfig,
  HostExitState,
  QueryResult,
} from '@/sourcequery/types';
import { FakeTailscaleRunner } from './fakes';

/** A minimal grounded QueryResult stand-in for scripted `runOne` returns. */
function makeQueryResult(url: string): QueryResult {
  return {
    summary: { count: 1, candidates: [] },
    captures: [
      { htmlPath: `${url}.html`, snapshotPath: `${url}.md`, url, capturedAtUtc: '2026-07-17T00:00:00.000Z' },
    ],
    source: 'fixture',
    query: 'q',
    retention: 'persist',
  };
}

function makeGrace(overrides: Partial<GraceWindowConfig> = {}): GraceWindowConfig {
  return {
    settleMs: 8000,
    extraSlowIntervalMs: 15000,
    maxRequests: 3,
    maxWindowMs: 60000,
    ...overrides,
  };
}

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

  describe('runApprovedSwitch', () => {
    /** Build a policy with an exposed fake clock so timing can be asserted. */
    function makeTimedPolicy(initialCurrentExitNode: string | null = null): {
      policy: ExitNodePolicy;
      runner: FakeTailscaleRunner;
      clockAt: () => number;
    } {
      const runner = new FakeTailscaleRunner([], initialCurrentExitNode);
      const { clock, sleep, now } = createFakeClock(0);
      const policy = new ExitNodePolicy({ tailscale: runner, clock, sleep });
      return { policy, runner, clockAt: now };
    }

    it('switches to hostname, runs all urls settled + spaced, then restores the prior node (setCalls = [switch, restore])', async () => {
      const { policy, runner, clockAt } = makeTimedPolicy('prior-node.example.ts.net');
      const node = makeNode({ hostname: 'nz-1', ip: '100.64.0.9' });
      const plan = ['https://s/a', 'https://s/b'];
      const grace = makeGrace({ settleMs: 8000, extraSlowIntervalMs: 15000 });
      const seenAt: number[] = [];

      const { results, ranAll } = await policy.runApprovedSwitch({
        node,
        priorState: { priorExitNode: 'prior-node.example.ts.net' },
        plan,
        grace,
        runOne: async (url) => {
          seenAt.push(clockAt());
          return makeQueryResult(url);
        },
      });

      // Exactly ONE switch + ONE restore.
      expect(runner.setCalls).toEqual(['nz-1', 'prior-node.example.ts.net']);
      expect(results).toHaveLength(2);
      expect(ranAll).toBe(true);
      // First runOne happened AFTER the settle (window measured from settle end).
      expect(seenAt[0]).toBe(8000);
      // Navigations spaced by extraSlowIntervalMs (only between, not before first).
      expect(seenAt[1] - seenAt[0]).toBe(15000);
    });

    it('switches to ip when hostname is empty', async () => {
      const { policy, runner } = makeTimedPolicy(null);
      const node = makeNode({ hostname: '', ip: '100.64.0.42' });

      await policy.runApprovedSwitch({
        node,
        priorState: { priorExitNode: null },
        plan: ['https://s/a'],
        grace: makeGrace(),
        runOne: async (url) => makeQueryResult(url),
      });

      expect(runner.setCalls[0]).toBe('100.64.0.42');
    });

    it("restores to '' (direct) when there was no prior exit node", async () => {
      const { policy, runner } = makeTimedPolicy(null);
      const node = makeNode({ hostname: 'nz-1' });

      await policy.runApprovedSwitch({
        node,
        priorState: { priorExitNode: null },
        plan: ['https://s/a'],
        grace: makeGrace(),
        runOne: async (url) => makeQueryResult(url),
      });

      expect(runner.setCalls).toEqual(['nz-1', '']);
    });

    it('stops at maxRequests (count bound), reporting partial coverage (ranAll false)', async () => {
      const { policy, runner } = makeTimedPolicy(null);
      const node = makeNode({ hostname: 'nz-1' });
      const plan = ['https://s/a', 'https://s/b', 'https://s/c', 'https://s/d'];
      const grace = makeGrace({ maxRequests: 2, maxWindowMs: 10_000_000 });

      const { results, ranAll } = await policy.runApprovedSwitch({
        node,
        priorState: { priorExitNode: null },
        plan,
        grace,
        runOne: async (url) => makeQueryResult(url),
      });

      expect(results).toHaveLength(2);
      expect(ranAll).toBe(false);
      // Host still restored exactly once after the bounded run.
      expect(runner.setCalls).toEqual(['nz-1', '']);
    });

    it('stops at maxWindowMs (time bound), reporting partial coverage (ranAll false)', async () => {
      const { policy, runner } = makeTimedPolicy(null);
      const node = makeNode({ hostname: 'nz-1' });
      const plan = ['https://s/a', 'https://s/b', 'https://s/c', 'https://s/d'];
      // maxRequests high so only the time bound can cut the run short.
      // After run 0 (no spacing) + spacing before run 1 (200ms), the window
      // (100ms) is already exceeded when i=2 is checked.
      const grace = makeGrace({
        settleMs: 0,
        extraSlowIntervalMs: 200,
        maxRequests: 10,
        maxWindowMs: 100,
      });

      const { results, ranAll } = await policy.runApprovedSwitch({
        node,
        priorState: { priorExitNode: null },
        plan,
        grace,
        runOne: async (url) => makeQueryResult(url),
      });

      expect(results).toHaveLength(2);
      expect(ranAll).toBe(false);
      expect(runner.setCalls).toEqual(['nz-1', '']);
    });

    it('burned node: when runOne throws, the promise rejects BUT host is still restored (SC-004)', async () => {
      const { policy, runner } = makeTimedPolicy('prior-node.example.ts.net');
      const node = makeNode({ hostname: 'nz-1' });

      await expect(
        policy.runApprovedSwitch({
          node,
          priorState: { priorExitNode: 'prior-node.example.ts.net' },
          plan: ['https://s/a'],
          grace: makeGrace(),
          runOne: async () => {
            throw new Error('still blocked after the approved exit-node switch (burned node)');
          },
        }),
      ).rejects.toThrow(/burned node/i);

      // The switch happened, and restore STILL ran on the abort path.
      expect(runner.setCalls).toEqual(['nz-1', 'prior-node.example.ts.net']);
      expect(runner.setCalls[1]).toBe('prior-node.example.ts.net');
    });

    it('escalation budget = 1/pass: issues exactly ONE switch regardless of plan length (FR-014)', async () => {
      const { policy, runner } = makeTimedPolicy('prior-node.example.ts.net');
      const node = makeNode({ hostname: 'nz-1', ip: '100.64.0.9' });
      // A long plan whose every url is reached (bounds generous enough to run all).
      const plan = ['https://s/a', 'https://s/b', 'https://s/c', 'https://s/d', 'https://s/e'];
      const grace = makeGrace({ maxRequests: 100, maxWindowMs: 10_000_000 });

      const { results, ranAll } = await policy.runApprovedSwitch({
        node,
        priorState: { priorExitNode: 'prior-node.example.ts.net' },
        plan,
        grace,
        runOne: async (url) => makeQueryResult(url),
      });

      // Every planned url ran under the single approval.
      expect(results).toHaveLength(plan.length);
      expect(ranAll).toBe(true);
      // Exactly ONE node change (+ the mandatory restore) across the whole pass:
      // no per-url or per-block re-switching. The budget is one switch per pass.
      expect(runner.setCalls).toEqual(['nz-1', 'prior-node.example.ts.net']);
      const switchCalls = runner.setCalls.filter((v) => v === 'nz-1');
      expect(switchCalls).toHaveLength(1);
    });
  });
});
