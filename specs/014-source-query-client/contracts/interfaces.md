# Contract: Injectable Interfaces

The boundaries that make the client unit-testable with no network and no host mutation (FR-018). Interface-first (Principle VI); no class inheritance.

## `BrowserSession`

```ts
interface PageResult {
  status: number | null;      // main-navigation HTTP status, null on error
  html: string;               // page.content()
  snapshotMarkdown: string;   // page.accessibility.snapshot() rendered
  errored: boolean;           // navigation error / timeout / drop
}

interface BrowserSession {
  open(): Promise<void>;
  navigate(url: string): Promise<PageResult>;
  close(): Promise<void>;
}
```

- **Real**: wraps Playwright `launchPersistentContext({ channel: 'chrome' })`, genuine Chrome UA. Launch failure throws.
- **Fake**: returns scripted `PageResult`s (result page / challenge stub / drop) keyed by URL; no browser.

## `TailscaleRunner`

```ts
interface TailscaleRunner {
  listExitNodes(): Promise<ExitNode[]>;
  currentExitNode(): Promise<string | null>;   // captured before any switch
  setExitNode(value: string): Promise<void>;    // '' clears to direct
}
```

- **Real**: execs `tailscale exit-node list` / `status --json` / `set --exit-node=…`.
- **Fake**: records calls, returns a scripted node list + current state; asserts in tests that `setExitNode` is called only after approval and that a restore call follows. **Never** touches the host (FR-015).

## `Clock` / `Sleep`

Injected `now()` and `sleep(ms)` (as in `HttpClient`) so pacing (`minIntervalMs`) and grace timing (`settleMs`/`extraSlowIntervalMs`/`maxWindowMs`) are deterministic under test.

## Policy units (composed, each independently testable)

- `PolitenessPolicy(rateLimiter, minIntervalMs)` — single session; enforces min inter-navigation interval.
- `Frugality` — `persistThenParse(pageResult, config)`: writes captures, parses from the persisted copy, runs verify-in-code grounding, throws on persistence failure or ungrounded output.
- `BlockDetection` — `classify(pageResult, config): 'result' | 'empty' | Block` per research R1.
- `ExitNodePolicy(tailscaleRunner, clock, sleep)` — enumerate/geo-select; `buildPermissionRequest(...)`; `runApprovedSwitch(node, plan, config)` = switch → settle → minimal set (extra-slow, bounded, each persisted) → restore.

## `SourceQueryClient`

Constructor-injected: `{ browser, tailscale, clock, sleep, registry }`. `query(sourceId, text, opts)` orchestrates the pass per the data-model state machine and returns `QueryResult` or an `OperatorPermissionRequest`.
