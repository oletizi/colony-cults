# Contract: Fetch/acquire guardrail for source groups (TASK-3)

The concrete resolution of backlog TASK-3. Keyed on the SSOT canonical `Source.kind` (R-001),
NOT on the `src/archive/location.ts` layout registry.

## Behavior

`runFetchSource` (`src/cli/fetch-source.ts`), at entry — after resolving `sourceId`, BEFORE
calling `sourceLayout(sourceId)`:

1. Look up the source's canonical kind (via `loadAllSources` from `@/bibliography/load`, or a
   focused `sourceKind(sourceId)` helper over it).
2. If `kind === 'source-group'` → **throw** with an actionable message:

   ```
   fetch-source: "PB-P004" is a Source Group — it has no archival object to fetch.
   Discover and inventory its members, then fetch the members.
   ```

3. Otherwise, proceed to the existing `sourceLayout`-driven dispatch unchanged.

## Requirements satisfied

- **FR-002 / US1**: any fetch/acquire of a group fails loud + informatively.
- **FR-003**: determination keys on kind, not identifier naming.
- **FR-011**: the refusal is an observable thrown error (non-zero exit at the CLI), not a
  silent no-op or partial fetch.
- **TASK-3**: replaces the opaque `sourceLayout: no archive layout registered for source
  "PB-P004"` throw with the actionable redirect.

## Edge cases

- **A member with no stable archival identity yet** (a `discovered` stub with no repository
  record): fetching it should also fail informatively — a source lacking a stable archival
  identity is assumed to require discovery, not acquisition (FR-003, general rule). This MAY be
  covered by the same guardrail extended to "no fetchable identity", or deferred to the member's
  own acquisition-readiness check; the contract requires only that such a fetch does not silently
  succeed or fail opaquely.
- **An unregistered non-group id** keeps today's `sourceLayout` throw (that path is a genuine
  "you forgot to register this", distinct from "this is a group by design").

## Non-goals

- The guardrail does not implement discovery/inventory. It refuses and redirects; the discovery
  pipeline is cataloguing (member stubs with `status: discovered`), not fetch code.
- No change to `SOURCE_LAYOUTS` — a group has no on-disk layout.

## Verification

- Integration: `fetch-source PB-P004 --source-id PB-P004` exits non-zero with the group message
  (not the layout-registry message). An ordinary fetchable source is unaffected.
