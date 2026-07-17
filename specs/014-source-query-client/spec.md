# Feature Specification: Source Query Client (Policy-as-Code for Polite, Frugal Source Access)

**Feature Branch**: `feature/corpus-gap-closure` (authored on the long-lived branch, per the 011–013 pattern)

**Created**: 2026-07-17

**Status**: Draft

**Input**: Approved design doc `docs/superpowers/specs/2026-07-17-source-query-client-design.md`. Originates from the `/fetching-online-sources` skill work: three same-session lapses proved discipline-only enforcement is insufficient, so the politeness/frugality mandate is moved into code.

## Clarifications

### Session 2026-07-17

- Q: How does the operator express approval for an exit-node switch at runtime? → A: The approval is **agent-mediated in-session** — the client emits its permission request and STOPS (returns control to the in-session agent rather than blocking on a TTY); the agent presents the request to the operator, who approves or declines in conversation; on approval the agent re-invokes the client with the approved node to perform the switch.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A query against a source is governed by code, not discipline (Priority: P1)

An operator or agent runs a discovery/reconnaissance query against an external source (e.g. Papers Past, Chronicling America, Gallica, an Internet Archive Solr endpoint). Instead of choosing a tool and remembering the rules, they invoke one shipped command. The command drives a real browser, paces itself, saves the raw page before anything is read, and hands back a summary whose facts are provably present in the saved page. There is no way to get an answer without the raw evidence landing on disk first.

**Why this priority**: This is the whole point — it makes the sanctioned path the path of least resistance and removes the discretion that produced every prior lapse. Without it, nothing else matters.

**Independent Test**: Run one governed query against a benign source (or a local fixture server); confirm a raw capture is written under `bibliography/repository-responses/<source>/` before the summary returns, and that the returned count string is present in the saved page. Delete/disable the persistence path and confirm the query fails loud rather than returning unsaved data.

**Acceptance Scenarios**:

1. **Given** a configured source and a query, **When** the client runs, **Then** it holds a single real-browser session, writes the raw HTML + accessibility snapshot to `bibliography/repository-responses/<source>/<slug>-<UTC>.{html,md}` before parsing, and returns a summary (e.g. result count + first-page candidates).
2. **Given** the persistence target cannot be written, **When** the client runs, **Then** it raises a hard error and returns nothing — never an unpersisted result.
3. **Given** a returned fact (e.g. a result count) that is not grep-present in the persisted page, **When** the client validates its own output, **Then** it fails loud (ungrounded output is rejected).
4. **Given** consecutive navigations in one pass, **When** the client issues them, **Then** each is separated by at least the configured minimum interval (single-session, rate-limited).

---

### User Story 2 - A walled source escalates to an operator-gated exit-node switch (Priority: P2)

A query hits a hard block (WAF challenge page, 403/429, or a dropped connection) that a different network origin could clear. Because switching the Tailscale exit node reroutes the **entire host machine**, the client must not do it silently. It persists the block evidence, stops, and presents the operator with a precise, reviewable escalation request. Only on explicit approval does anything change on the host — and it is undone afterward.

**Why this priority**: The escalation is the backstop that makes the browser mechanism viable against hard walls, but it touches the whole machine, so it must be human-gated and reversible. It is second only to the core governed query because most queries never need it.

**Independent Test**: With a fake block injected and a fake Tailscale runner, confirm the client persists block evidence, stops without switching, and emits an operator-permission request naming the source, evidence path, current origin, a geo-appropriate candidate node, the exact command, the host-wide-impact warning, and the pre-planned minimal query set. Then, on simulated approval, confirm it switches, runs only the minimal set under the grace discipline, and restores the prior exit-node state.

**Acceptance Scenarios**:

1. **Given** a hard block, **When** the client cannot proceed on the current origin, **Then** it persists the block evidence, does NOT switch, emits an operator-permission request containing: source, block-evidence path, current origin, a proposed geo-appropriate exit node (from the enumerated node list), the exact switch command, an explicit host-wide-impact warning, and the pre-planned minimal query set — and STOPS, returning control to the in-session agent (it does not block on a TTY); the agent presents the request to the operator and relays the decision.
2. **Given** the operator does not approve, **When** the pass ends, **Then** no exit-node change has occurred and the host routing is unchanged.
3. **Given** the operator approves, **When** the switch proceeds, **Then** the client performs the switch, waits a configured settle delay, runs ONLY the pre-planned minimal set under extra-slow pacing, stops at the configured window bound (time and/or request-count), persists each page, and then restores the host's prior exit-node state.
4. **Given** a completed or aborted escalation, **When** the pass ends, **Then** the host's exit-node state equals its pre-escalation state.
5. **Given** one escalation already occurred in a pass, **When** another block occurs, **Then** the client does not switch again without a fresh operator approval.

---

### User Story 3 - The skill and commandment point at the client (Priority: P3)

The `/fetching-online-sources` skill and the CLAUDE.md commandment are updated so the single sanctioned mechanism is the shipped client, with the Playwright MCP browser demoted to a manual fallback for cases the client genuinely cannot handle. An agent reading the skill is directed to the command, and the rationalization table / red flags name "reaching for the MCP browser or any tool instead of the client" as the violation.

**Why this priority**: The code makes the sanctioned path enforceable, but the agent still must choose it; the skill covers that seam. It depends on the client existing, so it lands last.

**Independent Test**: Read the updated skill + commandment; confirm they name the client as the mechanism, demote the MCP browser to fallback, and that the skill's guidance and the client's behavior are consistent (no contradictions).

**Acceptance Scenarios**:

1. **Given** the updated skill, **When** an agent consults it before a source query, **Then** it is directed to the shipped client as the one mechanism, with the MCP browser named as a governed manual fallback only.
2. **Given** the updated commandment, **When** it is read, **Then** it points at the client and lists the forbidden ad-hoc channels (curl, WebFetch, WebSearch-for-content, raw HttpClient, ungoverned browser calls).

---

### Edge Cases

- **Retention-forbidden source (Trove-class):** the source's ToS forbids retaining raw responses. The client persists nothing for that source and returns derived facts + attribution only (per DECISIONS.md), while still enforcing pacing and bounded queries.
- **No exit nodes available / Tailscale unavailable:** on a hard block with no usable candidate node (or no Tailscale), the client reports the block honestly and stops — it never fabricates results and never claims coverage it could not verify.
- **Browser cannot launch / real Chrome channel missing:** the client fails loud with a clear diagnostic rather than silently degrading to an ad-hoc fetch.
- **Grace window exhausted mid-plan:** if the window bound (time or request-count) is reached before the minimal set completes, the client stops at the bound, persists what it captured, restores host state, and reports the partial coverage explicitly (no silent truncation).
- **Pagination requested:** when the caller opts into pagination, the client walks pages under the same pacing + persistence rules; by default it fetches only the count/first page.
- **Operator approval arrives but the candidate node is already burned:** the client detects the continued block after the switch, respects the window bound, restores host state, and reports rather than churning nodes.

## Requirements *(mandatory)*

### Functional Requirements

**Mechanism & governance**

- **FR-001**: The system MUST provide one shipped, code-enforced mechanism (a `SourceQueryClient`, invoked via a CLI verb) for every query against an external source — discovery search, reconnaissance, metadata lookup, content/OCR read, holdings check.
- **FR-002**: The client MUST drive its own real browser (real Chrome channel + persistent profile) as the query transport; the Playwright MCP browser is demoted to a manual fallback and is not part of the code path.
- **FR-003**: The client MUST hold a single browser session per pass and separate consecutive navigations by at least a configured minimum interval (reusing the existing rate limiter).
- **FR-004**: The client MUST use a genuine Chrome User-Agent (wall-clearing); politeness/contactability is carried by low rate, ToS honoring, and a documented repo contact — not a bot-flagging descriptive UA.

**Frugality & persistence**

- **FR-005**: The client MUST persist each fetched page's raw content (HTML + accessibility snapshot) under `bibliography/repository-responses/<source>/<slug>-<UTC>.{html,md}` BEFORE any parsing or analysis.
- **FR-006**: The client MUST parse its returned summary from the persisted copy, and MUST fail loud (returning nothing) if persistence fails — it can never return unpersisted data.
- **FR-007**: The client MUST verify in code that key returned facts (e.g. the result count) are grep-present in the persisted page; ungrounded output MUST fail loud.
- **FR-008**: The client MUST issue bounded queries — count/first page only unless the caller explicitly opts into pagination — and MUST NOT make estimate-only pings whose result is discarded (Principle XII).
- **FR-009**: For a source whose ToS forbids retention, the client MUST persist nothing and return derived facts + attribution only, while still enforcing pacing and bounded queries.

**Exit-node escalation (operator-gated)**

- **FR-010**: On a hard block (WAF challenge / 403 / 429 / connection drop) that only a network-origin change could resolve, the client MUST persist the block evidence and STOP; it MUST NOT switch exit nodes autonomously.
- **FR-011**: The client MUST emit an operator-permission request containing: source, block-evidence path, current origin, a proposed geo-appropriate exit node (from the enumerated node list), the exact switch command, an explicit host-wide-impact warning, and the pre-planned minimal query set — and MUST then STOP, returning control to the in-session agent (it MUST NOT block on a TTY prompt). The in-session agent presents this request to the operator and relays the operator's decision.
- **FR-012**: Only on explicit operator approval — given by the operator in-session and relayed by the agent (a subsequent client invocation naming the approved node) — MAY a switch occur. On approval the client MUST perform the switch, apply a configured settle delay, execute ONLY the pre-planned minimal set under extra-slow pacing, stop at the configured window bound (time and/or request-count), and persist each page.
- **FR-013**: After a completed or aborted escalation, the client MUST restore the host's prior exit-node state.
- **FR-014**: The client MUST limit escalation to one node change per pass unless the operator re-approves ("sparingly").
- **FR-015**: The exit-node code path MUST be exercised in automated tests only through an injectable fake runner; it MUST NEVER switch the real host during tests.

**Configuration**

- **FR-016**: The system MUST support per-source configuration: query-URL builder, ToS retention rule (persist vs derived-facts-only), preferred geo, grace-window parameters (settle delay, extra-slow interval, window bound as time and/or request-count), and attribution string.

**Integration**

- **FR-017**: The `/fetching-online-sources` skill and the CLAUDE.md commandment MUST be updated to name the shipped client as the single sanctioned mechanism, demote the MCP browser to a governed manual fallback, and keep the skill's guidance consistent with the client's behavior.

**Testability**

- **FR-018**: Each policy unit (politeness, frugality/persistence, exit-node) MUST expose an injectable boundary (fake browser session, fake Tailscale runner, fake clock/sleep) so behavior is unit-testable with no network and no host mutation.

### Key Entities *(include if feature involves data)*

- **SourceConfig**: per-source settings — query-URL construction, ToS retention rule, preferred geo, grace-window parameters, attribution.
- **QueryResult**: the returned summary — result count, first-page candidates, and the path(s) to the persisted raw capture(s) that ground every fact.
- **PersistedCapture**: a raw source response on disk (HTML + accessibility snapshot) written before analysis; the durable evidence for any claim.
- **ExitNode**: an enumerated Tailscale exit-node candidate — identity/host, country/city (for geo-selection).
- **OperatorPermissionRequest**: the human-gated escalation artifact — source, block evidence, current origin, proposed node, exact command, host-wide-impact warning, pre-planned minimal query set.
- **BlockEvidence**: the persisted proof that a source hard-blocked the current origin (the challenge page / status), justifying an escalation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of governed queries write a raw capture to disk before returning a summary; a query that cannot persist returns no data (0 unpersisted results).
- **SC-002**: 100% of returned summary facts are grep-traceable in the persisted capture; any ungrounded fact aborts the query.
- **SC-003**: 0 autonomous exit-node switches occur — every switch in the record is preceded by an explicit operator approval.
- **SC-004**: After every escalation (approved, declined, or aborted), the host's exit-node state matches its pre-escalation state (0 residual host mutations).
- **SC-005**: A source query performed through the client requires no tool-choice decision by the operator/agent beyond invoking the one command (the sanctioned path is the only path).
- **SC-006**: All policy units pass unit tests with injected fakes and no network access; the exit-node path never mutates the real host in the test suite.

## Assumptions

- A real browser (Chrome channel) can be launched on the host; where a display is unavailable, headed emulation or a persistent profile is used — a browser that cannot launch is a hard error, not a silent fallback.
- Tailscale is present with an enumerable exit-node pool (confirmed: a Mullvad fleet is available); absence is handled by honest reporting, not fabrication.
- The existing `src/gallica/rate-limiter.ts` is reused for pacing.
- Bulk asset **acquisition** (mirroring public-domain documents) is out of scope and remains the existing acquire pipeline; the `HttpClient` is not replaced for acquisition byte-downloads.
- Autonomous exit-node switching is out of scope permanently — the operator gate is a permanent design property, not a v1 limitation.
- Persisted captures follow the existing `bibliography/repository-responses/<source>/` convention.
