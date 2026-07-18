---
name: "fetching-online-sources"
description: "Use when about to make ANY query against an external online source or repository during corpus work — discovery search, reconnaissance, metadata lookup, OCR/content read, or checking whether a source holds something (Gallica, Internet Archive, Trove, Papers Past, Chronicling America, DigitalNZ, library/museum/newspaper/parliamentary portals, or any source whose content you will cite). Trigger symptoms of an imminent violation: reaching for WebFetch, WebSearch-for-content, curl, the raw HttpClient, or an ad-hoc/ungoverned browser call against a source URL; fetching a page you will not save; telling yourself 'it is just a quick check' or 'this source is walled so I'll improvise' or 'a browser is overkill here'."
metadata:
  author: "colony-cults"
  enforces: "constitution Principle XII (Respect the Source); DECISIONS.md store-raw-responses"
user-invocable: true
disable-model-invocation: false
---

# Fetching Online Sources (Governed Source Query Client)

## Overview

EVERY query against an external source/repository during corpus work goes through ONE mechanism: the governed **`bib query-source`** client (`src/cli/bib-query-source.ts`), with the raw page content persisted before analysis. No exceptions. No second channel. This operationalizes constitution **Principle XII** (Respect the Source) + the DECISIONS.md store-raw-responses convention.

The client drives a governed real browser under the hood, so it uniformly works across every source — rendering JS, carrying cookies, and clearing the WAF/challenge walls (Incapsula, Anubis, Cloudflare) that a headless client structurally cannot — so there is never a "the mechanism failed, let me reach for another tool" moment. The Trove wall (SRCH-0016) was cleared exactly this way. Critically, the client enforces persist-first, frugal, polite, and graceful escalation IN CODE, not as discipline. One mechanism means zero tool-choice decisions, and the tool-choice decision is where every lapse has come from.

**Violating the letter of this rule is violating the spirit of it. "The source is walled" / "it's just a quick check" / "the API is cleaner" / "a browser is overkill" are NOT exceptions — they are the rationalizations this skill exists to stop.**

## The one sanctioned mechanism

Query every source with the **`bib query-source` client**:

```
bib query-source <source-id> --query "<text>" [--pages <n>] [--approve-exit-node <node>]
```

The client enforces four governance points IN CODE:

1. **Persist before analysis.** The client writes the raw page content (accessibility snapshot AND/OR full HTML) under `bibliography/repository-responses/<source>/<slug>-<UTC>.{md,html}` BEFORE returning. Never analyze a page you did not save. Every fact you later cite MUST be grep-traceable in a persisted capture.
2. **Frugal.** Narrowest bounded queries; the client reads the result count / first page — does not walk pagination unless the task truly requires it. Never make a query whose result you discard. No estimate-only pings.
3. **Polite.** One browser session; the client paces navigations; no paywall/login circumvention; obeys each source's ToS. Where a ToS forbids retention (e.g. Trove — DECISIONS.md), the client persists NOTHING and records only derived facts + attribution instead.
4. **Graceful escalation.** On a hard block (WAF challenge beyond operator clearance), the client persists block evidence under `bibliography/repository-responses/<source>/` and STOPS with an operator-permission request (exit code 3), rather than switching autonomously to another tool or trying a workaround.

## Governed manual fallback (unregistered sources)

The Playwright MCP browser (`browser_navigate`, `browser_snapshot`, `browser_evaluate`, `browser_close`) remains available ONLY as a governed fallback for a source not yet wired as a `SourceConfig` in the client. Even in this case, the same persist-first discipline applies: save the raw page under `bibliography/repository-responses/<source>/` BEFORE analysis.

**The correct response to "the client doesn't support this source yet" is to register a `SourceConfig` (or fix the skill), NOT to route around the client by using the browser for a source it already supports.**

## Forbidden — every other channel, no exceptions

NEVER query a source with any of these. Each is a violation — even "just once", even for a "public GET", even when a tool seems like overkill:

- `curl` / any shell HTTP against a source URL
- `WebFetch` against a source/repository page
- `WebSearch` to pull source content, OCR, metadata, or any page you will cite
- the raw `HttpClient` for a source query
- an ad-hoc browser call made OUTSIDE this governed persist-first process (a browser peek you do not save is still a violation)
- reaching for the Playwright MCP browser (or any other tool) for a source the client already supports, instead of `bib query-source`

`WebSearch` is permitted for ONE narrow thing: locating that a source exists / its URL. That is not a query against the source, and you may never cite content from the search snippet.

(Bulk asset acquisition — mirroring a public-domain document for the corpus — is the separate shipped acquire pipeline, already Principle-XII-governed. This skill governs QUERIES: search, reconnaissance, metadata, content reads.)

## If the mechanism seems not to fit

That feeling is the hole you keep climbing through. Do NOT improvise another tool. STOP and fix THIS skill (add the governed handling for the new case), then query through it. The mandated mechanism is never the thing you route around.

## Rationalization table

| Excuse | Reality |
|--------|---------|
| "The source is walled — the client can't, so I'll improvise" | The client drives a governed real browser under the hood and is the wall-clearing mechanism. Use it. If it genuinely cannot, fix the skill — never improvise a side channel. |
| "It's just a quick reconnaissance check" | Reconnaissance is in scope. One bounded query via `bib query-source`, persisted. |
| "It's a public GET / the API is cleaner than a browser" | The uniform mechanism removes the tool-choice that keeps producing lapses. Client, no exceptions. |
| "A browser is overkill for this one" | "Overkill" is how the exception starts. There are none. |
| "I'll persist it later" | Persist BEFORE analysis. An unsaved page is unverifiable. |
| "I just need to verify one claim" | Verifying a claim IS a source query. Use `bib query-source`, persisted. |
| "I'll just use the MCP browser directly, it's faster" | The client IS the governed browser plus the code-enforced persist/ground/pace/escalate discipline. Use `bib query-source`; the raw browser is a fallback for unregistered sources only. |

## Red flags — STOP

- About to call `WebFetch`, `curl`, `HttpClient`, or `WebSearch`-for-content on a source
- About to make a browser call without saving the page first
- About to drive the Playwright MCP browser (or any tool) for a source `bib query-source` supports, instead of the client
- Telling yourself the source is walled / the browser is overkill / it's just a quick check
- About to analyze a page you did not persist

**All of these mean: stop, use `bib query-source`, persist the raw page, THEN analyze.**
