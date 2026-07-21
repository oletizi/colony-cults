# Source Query Client — Policy-as-Code for Polite, Frugal Source Access

**Status:** design (pending operator review)
**Date:** 2026-07-17
**Enforces:** constitution Principle XII (Respect the Source); DECISIONS.md store-raw-responses
**Supersedes (as the enforcement locus):** the discipline-only mandate in the `/fetching-online-sources` skill

## Problem

`/fetching-online-sources` mandates that every query against an external source go through a governed real-browser session with raw-page persistence. Today that mandate is **discipline only** — enforced by the agent reading the skill. In one session it failed three times: an agent used ad-hoc `WebFetch` for reconnaissance; after a first skill mandated only the headless `HttpClient`, an agent hit a WAF wall and reached for a raw browser *outside* the skill; and a "WAF-walled" claim was relayed unverified. The pattern: whenever the sanctioned mechanism seems not to fit, the agent improvises a side channel.

Policy as code removes the discretion. A shipped client that *is* the mechanism cannot be routed around: it drives the browser, enforces pacing and persistence, and gates the one host-affecting escalation (Tailscale exit-node rotation) behind explicit operator permission.

## Goals

- Every source **query** (search, reconnaissance, metadata lookup, content/OCR read, holdings check) runs through one shipped, code-enforced mechanism.
- Politeness and frugality are enforced by code, not agent discipline: pacing, single session, persist-before-return, bounded queries, verify-in-code.
- A real browser (wall-clearing) is the transport, driven by the client itself.
- Exit-node rotation exists as a **sparingly-used, operator-gated, last-resort** escalation with a code-enforced grace-period discipline, and always restores the host to its prior state.

## Non-goals

- Bulk asset **acquisition** (mirroring public-domain documents into the corpus). That remains the existing, separately-governed acquire pipeline. This client governs *queries* that produce information/evidence.
- Replacing the `HttpClient` for acquisition byte-downloads.
- Autonomous exit-node switching. Never.

## Decisions (operator-confirmed)

1. **Code drives its own real browser.** Add `playwright` as a dependency; the client launches a real browser and bakes all policy into code. The Playwright *MCP* browser is demoted to a manual fallback (MCP tools are agent-invoked and cannot be wrapped by code).
2. **Exit-node rotation is a last resort requiring operator permission** — because `tailscale set` reroutes the entire host machine. The client never switches autonomously.
3. **Grace period: both + configurable.** After a switch: a settle delay, a pre-planned minimal query set, and extra-slow pacing, with the window bound (time and/or request-count) configurable per source.
4. **On approval, the tool performs the switch, then restores** the host's prior exit-node state automatically (so grace timing is code-controlled and the host is left as found).
5. **Browser identity:** a genuine Chrome User-Agent (wall-clearing). Contactability/politeness is carried by low rate, ToS honoring, and a documented contact in the repo — not by a bot-flagging descriptive UA.

## Architecture

New module `src/sourcequery/`. Components, each with one clear purpose and an injectable boundary for testing (mirroring how `HttpClient` injects `fetch`/`sleep`/`clock`):

| Unit | Responsibility | Key dependency |
|------|----------------|----------------|
| `SourceQueryClient` | Orchestrate one governed query pass: hold a single browser session, run bounded queries, drive persistence + pacing, raise the exit-node escalation. Agent-facing. | `BrowserSession`, policies, `SourceConfig` |
| `BrowserSession` | Thin wrapper over the Playwright browser/context/page (real Chrome channel, persistent profile). Injectable — a fake in unit tests. | `playwright` |
| `PolitenessPolicy` | Single session; min inter-navigation interval per source. Reuses `src/gallica/rate-limiter.ts`. | `RateLimiter` (injected clock/sleep) |
| `FrugalityPolicy` (persistence) | Write raw HTML + accessibility snapshot under `bibliography/repository-responses/<source>/<slug>-<UTC>.{html,md}` **before returning**; parse the summary from the persisted copy; persistence failure → hard error. Bounded queries (count/first page unless caller opts into pagination). | fs |
| `ExitNodePolicy` | Enumerate nodes (`tailscale exit-node list`), geo-select; generate the operator-permission request on block; on approval perform switch → grace-disciplined minimal set → restore prior state. Never switches autonomously. | injectable `TailscaleRunner` |
| `SourceConfig` | Per-source knobs: query-URL builder, ToS retention rule (persist vs derived-facts-only, e.g. Trove), preferred geo, grace-window params (settle ms, max requests, inter-request ms), attribution string. | — |

CLI entry: `bib query-source <source> --query "…" [--pages N]` (agent-facing verb; the sanctioned way to run a source query).

## Policy enforced in code (autonomous, safe)

- **Politeness:** one browser session per pass; min inter-navigation interval (default ~1 req/s, per-source configurable); real-Chrome fingerprint; honor per-source ToS config; no login/paywall circumvention.
- **Frugality:** persist-before-return (parse from the saved copy; persistence failure is a hard error, never a silent empty); bounded queries; no estimate-only pings (Principle XII forbids a ping-and-discard dry run).
- **Verify-in-code:** the returned summary's key facts (e.g. the result count) are asserted grep-present in the persisted page — a code-level version of the skill's "grep-traceable" rule. Ungrounded → fail loud.
- **ToS waiver:** per-source; where retention is forbidden (Trove), persist nothing, return derived facts + attribution only.

## Exit-node escalation (human-gated, grace-disciplined)

Flow when a query hits a hard block (WAF challenge / 403 / 429 / connection drop) that only a node change could resolve:

1. The client **persists the block evidence** and **stops** — it does not rotate.
2. It emits an **operator-permission request**: source, block evidence path, current origin, a proposed geo-appropriate node (from `tailscale exit-node list`), the exact `tailscale set --exit-node=<node>` command, an explicit host-wide-impact warning, and the **pre-planned minimal query set** it will run in the grace window.
3. On explicit operator approval, the tool: runs `tailscale set --exit-node=<node>` → applies the **settle delay** → executes **only** the pre-planned minimal set under **extra-slow pacing** → **stops at the window bound** (time and/or request-count, per `SourceConfig`) → persists each page → **restores the host's prior exit-node state** (`tailscale set --exit-node=<prior|empty>`).
4. Budget: one node change per pass unless re-approved. "Sparingly" is enforced by the human gate itself.

The exit-node path is unit-tested only with a fake `TailscaleRunner`; it is never exercised against the real host in automated tests.

## Skill & commandment integration

- `/fetching-online-sources`: the single sanctioned mechanism becomes the shipped `bib query-source` client. The Playwright MCP browser is demoted to a manual fallback for cases the client genuinely can't handle — still under the skill's rules. Update the rationalization table + red flags to name "reaching for the MCP browser or any tool instead of `bib query-source`" as the violation.
- CLAUDE.md commandment points at the client.
- The skill remains the discipline doc; the code is the enforcement; they stay in sync.

## Testing

- **Unit (no network):** `PolitenessPolicy` (pacing via injected clock/sleep); `FrugalityPolicy` (persist-before-return, fail-loud on persistence failure, verify-in-code grounding); `ExitNodePolicy` (node-list parsing, geo-select, permission-request generation, grace-window bounds, restore logic) — all with injected fakes (`BrowserSession`, `TailscaleRunner`, clock).
- **Integration (opt-in / env-gated):** one end-to-end governed query against a benign source or a local fixture server, confirming a page is persisted and the summary is grounded. Real-network integration stays opt-in to avoid hammering sources in CI.

## Open item — packaging route

Pending operator choice: (a) promote this design into a Spec Kit spec `014-source-query-client` via `stack-control:define` → `execute` (consistent with 011/012/013), or (b) the lighter `superpowers:writing-plans` path. No code is written until this and the design are approved.

## Risks

- **Headless/library-driven Chromium is more wall-prone than the MCP's browser.** Mitigate with the real Chrome channel + a persistent profile + headed mode where a display is available; the exit-node escalation is the backstop when a source still walls us.
- **`playwright` is a heavy dependency** (browser download, CI weight). Accepted for the wall-clearing capability the mandate requires.
- **Discipline still matters at the seam:** the code enforces the mechanism, but the agent must still *choose* `bib query-source` over ad-hoc tools. The skill + commandment cover that seam; the client makes the sanctioned path the path of least resistance.
