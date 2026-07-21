# Phase 0 Research: Source Query Client

Resolves the plan-level unknowns (including the block-detection detail deferred from `/speckit-clarify`).

## R1 — Block detection: distinguish a hard block from a legitimate empty result

**Decision**: Classify a navigation outcome as a **hard block** only on a positive signal, never on an empty result set:
- HTTP status 403 / 429 / 5xx captured via a Playwright response listener on the main navigation, OR
- a navigation error / timeout / connection drop, OR
- the settled page body matches a known challenge fingerprint (case-insensitive): `Incapsula incident ID`, `Request unsuccessful`, `Just a moment` (Cloudflare), `Attention Required`, `cf-chl`, Anubis markers, or the `automatic … redirect … challenge` triad, AND the page lacks the source's expected result-container selector.

A page that renders the expected result container — even with **zero** rows — is a legitimate empty result, **not** a block. Escalation never fires on a valid empty result.

**Rationale**: A false-positive block would trigger a spurious host-mutation permission request. Requiring a positive fingerprint / status / drop keeps escalation conservative and matches the observed reality (Papers Past cleared in a real browser; the stateless client got Incapsula stubs).

**Alternatives considered**: Treating any zero-result as a possible block (rejected — conflates legitimate emptiness with a wall, causes spurious escalations). Status-only detection (rejected — WAF challenge pages often return 200 with a challenge body).

## R2 — Browser: real Chrome channel, persistent profile, headed-first

**Decision**: Launch via Playwright `chromium.launchPersistentContext(userDataDir, { channel: 'chrome', headless: <auto> })` — the **real installed Chrome** (not bundled Chromium) with a **persistent profile**. Headed when a display is available; `headless: 'new'` (new headless mode) otherwise. A launch failure is a hard error (Principle V) — never a silent fall-back to an ad-hoc fetch.

**Rationale**: Real Chrome + a persistent profile + cookies is what clears the JS/cookie WAF walls (Incapsula/Cloudflare/Anubis) that a headless stateless client cannot — the entire justification for a browser mechanism. Bundled headless Chromium is the most bot-detectable configuration.

**Alternatives considered**: Bundled headless Chromium (rejected — highest wall-block rate). Reusing the existing `HttpClient` (rejected — cannot clear JS/cookie walls; that is the problem being solved).

## R3 — First reference source + the deterministic test target

**Decision**: Ship two `SourceConfig`s initially: (1) **Papers Past** (`paperspast.natlib.govt.nz/newspapers`) as the first live config — a real TASK-39 target that a real browser reaches, exercising count + first-page parsing; (2) a **local fixture server** config for the deterministic integration test (a static results page + a static challenge page), so the end-to-end path is testable without hitting a live source.

**Rationale**: Papers Past is an already-motivated, browser-reachable target; the fixture server makes the integration test hermetic and CI-safe.

**Alternatives considered**: Chronicling America first (viable via loc.gov JSON, but its API is fetchable without a browser, so it is a weaker first proof of the browser mechanism). Trove first (rejected — retention-forbidden ToS complicates the first config).

## R4 — Tailscale command specifics (behind an injectable runner)

**Decision**: All host interaction goes through an injectable `TailscaleRunner` (an exec wrapper):
- **enumerate**: `tailscale exit-node list` → parse the table (IP, HOSTNAME, COUNTRY, CITY, STATUS).
- **current state**: `tailscale status --json` → read the active exit node (`ExitNodeStatus` / peer `ExitNode: true`), captured **before** any switch so it can be restored.
- **switch**: `tailscale set --exit-node=<ip-or-hostname>`.
- **restore**: `tailscale set --exit-node=<prior-value>` (empty string clears to direct if there was no prior node).

Geo-selection: prefer a candidate whose COUNTRY matches the `SourceConfig.preferredGeo`, else nearest-region heuristic, else any online node.

**Rationale**: The runner boundary lets unit tests use a fake that records commands and never touches the real host (FR-015). Capturing prior state before switching guarantees restore (FR-013 / SC-004).

**Alternatives considered**: A Tailscale API/library (rejected — the CLI is already present, faithful-tool-adoption; no new dependency).

## R5 — Persistence format

**Decision**: For each fetched page persist two files under `bibliography/repository-responses/<source>/`: `<slug>-<UTC>.html` (raw `page.content()`) and `<slug>-<UTC>.md` (the `page.accessibility.snapshot()` rendered to markdown). `<slug>` derives from source id + a sanitized query; `<UTC>` is an ISO timestamp. Block evidence uses a `block-<UTC>.{html,md}` name. Writes happen **before** any parsing; a write failure throws.

**Rationale**: Matches the existing `repository-responses/<source>/` convention and the skill's "raw HTML + accessibility snapshot" capture. Two artifacts give both machine-parseable HTML and a human-readable snapshot.

**Alternatives considered**: Screenshot capture (rejected as the primary artifact — not grep-traceable for verify-in-code; may be added later as a non-primary aid).

## R6 — Grace-window parameters + conservative defaults

**Decision**: `SourceConfig.grace = { settleMs, extraSlowIntervalMs, maxRequests, maxWindowMs }`. Defaults (conservative, per-source overridable): `settleMs: 8000`, `extraSlowIntervalMs: 15000`, `maxRequests: 3`, `maxWindowMs: 60000`. After a switch: wait `settleMs`, then run only the pre-planned minimal set, one navigation per `extraSlowIntervalMs`, stopping at the first of `maxRequests` reached or `maxWindowMs` elapsed. Then restore host state.

**Rationale**: Encodes the operator's "both + configurable" grace model (settle + pre-planned minimal set + extra-slow pacing + bound). Conservative defaults honor "utmost respect" for the hairtrigger gate; per-source override tunes it.

**Alternatives considered**: A single global grace config (rejected — different sources have different tolerances; per-source is required by FR-016).

## R7 — Verify-in-code grounding

**Decision**: After parsing a summary fact (e.g. the result count) from the persisted HTML, assert the extracted value's string form is a literal substring of the persisted file's bytes. If absent, throw (ungrounded output → fail loud, FR-007). The parse reads the **persisted** copy, not the live DOM, so the returned fact and the evidence are the same bytes.

**Rationale**: A code-level enforcement of the skill's "every cited fact must be grep-traceable in a persisted capture." Parsing from the saved copy closes the gap where a returned number could differ from what was stored.

## R8 — Block evidence as first-class provenance

**Decision**: On a detected block, persist the challenge page (HTML + snapshot) as `block-<UTC>.{html,md}` **before** raising the escalation, and reference its path in the `OperatorPermissionRequest`. The escalation cannot be raised without persisted evidence.

**Rationale**: The operator (and the record) can see exactly what the wall looked like; escalation decisions rest on saved evidence, not an unverifiable claim (the "WAF-walled" lesson).
