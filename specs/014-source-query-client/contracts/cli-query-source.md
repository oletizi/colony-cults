# Contract: `bib query-source` CLI verb

The agent-facing entry point. The one sanctioned way to run a source query.

## Invocation

```
bib query-source <source-id> --query "<text>" [--pages <n>] [--approve-exit-node <node>]
```

| Arg / flag | Required | Meaning |
|------------|----------|---------|
| `<source-id>` | yes | a registered `SourceConfig` id (e.g. `papers-past`) |
| `--query` | yes | the query text |
| `--pages <n>` | no | walk `n` result pages (default 1 — count/first page only, FR-008) |
| `--approve-exit-node <node>` | no | operator-approved node for the escalation re-invocation (FR-012); ip or hostname |

## Behaviour & exit codes

| Outcome | stdout | exit |
|---------|--------|------|
| Success (result or legit empty) | JSON `QueryResult` (summary + persisted capture paths) | 0 |
| Hard block, no approval flag | JSON `OperatorPermissionRequest` + a human-readable escalation notice | 3 |
| Grace pass with `--approve-exit-node` | JSON `QueryResult` (partial or full); host state restored | 0 |
| Persistence failure / browser-launch failure / ungrounded output | error to stderr, nothing on stdout | non-zero (fail loud) |
| Unknown source id / no usable exit node | error to stderr naming the gap | non-zero |

## Invariants (asserted, not advisory)

- No `QueryResult` is emitted without its captures already on disk (except `derived-facts-only` sources, which emit derived facts + attribution and persist nothing).
- Exit code 3 (escalation) NEVER accompanies an autonomous switch — a switch only happens on a subsequent call carrying `--approve-exit-node`.
- After any run that touched the exit node, the host's exit-node state equals its pre-run state.
- The agent reads exit code 3 + the `OperatorPermissionRequest`, asks the operator, and (only on approval) re-invokes with `--approve-exit-node <proposedNode>`.
