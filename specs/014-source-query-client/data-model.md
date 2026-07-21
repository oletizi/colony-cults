# Phase 1 Data Model: Source Query Client

Typed entities (all in `src/sourcequery/types.ts` unless noted). No `any`/`as` (Principle VII).

## SourceConfig (`source-config.ts`)

Per-source knobs; the registry maps a source id → config.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | source key, also the `repository-responses/<id>/` dir |
| `baseUrl` | `string` | source origin |
| `buildQueryUrl` | `(query: string, page?: number) => string` | native query-URL builder |
| `resultSelector` | `string` | selector proving a real result page rendered (block-detection anchor) |
| `parseSummary` | `(html: string) => QuerySummary` | count + first-page candidates, parsed from persisted HTML |
| `retention` | `'persist' \| 'derived-facts-only'` | Trove-class = `derived-facts-only` (FR-009) |
| `attribution` | `string` | required credit line for derived-facts sources |
| `preferredGeo` | `string \| undefined` | ISO country for geo-selecting an exit node |
| `minIntervalMs` | `number` | normal-pass pacing (default ~1000) |
| `grace` | `GraceWindowConfig` | post-switch discipline |

## GraceWindowConfig

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `settleMs` | `number` | 8000 | node warm-up wait after a switch |
| `extraSlowIntervalMs` | `number` | 15000 | inter-navigation delay during the grace window |
| `maxRequests` | `number` | 3 | request-count bound |
| `maxWindowMs` | `number` | 60000 | time bound |

## QuerySummary / QueryResult

- **QuerySummary**: `{ count: number; candidates: Candidate[] }` — parsed from persisted HTML.
- **Candidate**: `{ title: string; ref: string; date?: string }`.
- **QueryResult**: `{ summary: QuerySummary; captures: PersistedCapture[]; source: string; query: string }` — the returned value; every fact in `summary` is grounded in `captures`.

## PersistedCapture

| Field | Type | Notes |
|-------|------|-------|
| `htmlPath` | `string` | `repository-responses/<source>/<slug>-<UTC>.html` |
| `snapshotPath` | `string` | `…-<UTC>.md` (a11y snapshot) |
| `url` | `string` | the queried URL |
| `capturedAtUtc` | `string` | ISO timestamp (passed in, not `Date.now()` in library core) |

For a `derived-facts-only` source, `captures` is empty and `QueryResult` carries `derivedFacts` + `attribution` instead (no raw retention).

## ExitNode

`{ ip: string; hostname: string; country: string; city: string; online: boolean }` — one enumerated `tailscale exit-node list` row.

## HostExitState

`{ priorExitNode: string | null }` — captured before any switch (from `tailscale status --json`); the restore target (FR-013).

## BlockEvidence

`{ kind: 'status' | 'challenge' | 'drop'; detail: string; evidencePath: string; capturedAtUtc: string }` — persisted proof of a hard block; `evidencePath` → the `block-<UTC>.{html,md}` capture.

## OperatorPermissionRequest

The agent-facing escalation artifact (FR-011). The client returns this and STOPS.

| Field | Type | Notes |
|-------|------|-------|
| `source` | `string` | |
| `blockEvidence` | `BlockEvidence` | persisted proof |
| `currentOrigin` | `string` | current exit node or "direct" |
| `proposedNode` | `ExitNode` | geo-appropriate candidate |
| `switchCommand` | `string` | exact `tailscale set --exit-node=…` |
| `hostImpactWarning` | `string` | "reroutes the entire host machine" |
| `minimalQueryPlan` | `string[]` | the pre-planned minimal set to run in the grace window |

## Injectable boundaries (interfaces)

- **BrowserSession** (`browser-session.ts`): `open()`, `navigate(url): Promise<PageResult>` (`PageResult = { status: number \| null; html: string; snapshotMarkdown: string; errored: boolean }`), `close()`. Real impl wraps Playwright; the fake returns scripted `PageResult`s.
- **TailscaleRunner** (`tailscale-runner.ts`): `listExitNodes()`, `currentExitNode()`, `setExitNode(value: string)`. Real impl execs `tailscale`; the fake records calls and never touches the host (FR-015).
- **Clock/Sleep**: injected (as in `HttpClient`) so pacing/grace timing is deterministic in tests.

## State transitions (one query pass)

```
open session → navigate(query) → [persist raw page] → detect outcome
  ├─ result page → parse summary from persisted HTML → verify-in-code grounding → QueryResult
  ├─ legit empty → QueryResult(count 0)
  └─ hard block → persist BlockEvidence → build OperatorPermissionRequest → STOP (return request)
        └─ (re-invoked with approved node) → setExitNode(node) → settle → minimal set (extra-slow, bounded, each persisted) → restore prior exit state → QueryResult(partial|full)
close session (always)
```
