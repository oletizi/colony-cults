---
name: "fetching-online-sources"
description: "Use when about to make ANY query against an external online source or repository during corpus work — discovery search, reconnaissance, metadata lookup, OCR/content read, or checking whether a source holds something (Gallica, Internet Archive, Trove, Papers Past, Chronicling America, DigitalNZ, library/museum/newspaper/parliamentary portals, or any source whose content you will cite). Trigger symptoms of an imminent violation: reaching for WebFetch, WebSearch-for-content, curl, the raw HttpClient, or an ad-hoc/ungoverned browser call against a source URL; fetching a page you will not save; telling yourself 'it is just a quick check' or 'this source is walled so I'll improvise' or 'a browser is overkill here'."
metadata:
  author: "colony-cults"
  enforces: "constitution Principle XII (Respect the Source); DECISIONS.md store-raw-responses"
user-invocable: true
disable-model-invocation: false
---

# Fetching Online Sources (Governed Real-Browser Access)

## Overview

EVERY query against an external source/repository during corpus work goes through ONE mechanism: a **governed real-browser session** (the Playwright MCP browser), with the raw page content persisted before analysis. No exceptions. No second channel. This operationalizes constitution **Principle XII** (Respect the Source) + the DECISIONS.md store-raw-responses convention.

A real browser is the only mechanism that works UNIFORMLY across every source — it renders JS, carries cookies, and clears the WAF/challenge walls (Incapsula, Anubis, Cloudflare) that a headless client structurally cannot — so there is never a "the mechanism failed, let me reach for another tool" moment. The Trove wall (SRCH-0016) was cleared exactly this way. One mechanism means zero tool-choice decisions, and the tool-choice decision is where every lapse has come from.

**Violating the letter of this rule is violating the spirit of it. "The source is walled" / "it's just a quick check" / "the API is cleaner" / "a browser is overkill" are NOT exceptions — they are the rationalizations this skill exists to stop.**

## The one sanctioned mechanism

Query every source with a **real browser** (Playwright MCP: `browser_navigate`, `browser_snapshot`, `browser_evaluate`, ...), governed by:

1. **Persist before analysis.** Before reading or parsing anything, save the page's raw content (accessibility snapshot AND/OR full HTML) under `bibliography/repository-responses/<source>/<slug>-<UTC>.{md,html}`. Never analyze a page you did not save. Every fact you later cite MUST be grep-traceable in a persisted capture.
2. **Frugal.** Narrowest bounded queries; read the result count / first page — do not walk pagination unless the task truly requires it. Never make a query whose result you discard. No estimate-only pings.
3. **Polite.** One browser session; pace navigations; no paywall/login circumvention; obey each source's ToS. Where a ToS forbids retention (e.g. Trove — DECISIONS.md), persist NOTHING and record only derived facts + attribution instead.
4. **Close the session** (`browser_close`) when the pass is done.

## Forbidden — every other channel, no exceptions

NEVER query a source with any of these. Each is a violation — even "just once", even for a "public GET", even when the browser seems like overkill:

- `curl` / any shell HTTP against a source URL
- `WebFetch` against a source/repository page
- `WebSearch` to pull source content, OCR, metadata, or any page you will cite
- the raw `HttpClient` for a source query
- an ad-hoc browser call made OUTSIDE this governed persist-first process (a browser peek you do not save is still a violation)

`WebSearch` is permitted for ONE narrow thing: locating that a source exists / its URL. That is not a query against the source, and you may never cite content from the search snippet.

(Bulk asset acquisition — mirroring a public-domain document for the corpus — is the separate shipped acquire pipeline, already Principle-XII-governed. This skill governs QUERIES: search, reconnaissance, metadata, content reads.)

## If the mechanism seems not to fit

That feeling is the hole you keep climbing through. Do NOT improvise another tool. STOP and fix THIS skill (add the governed handling for the new case), then query through it. The mandated mechanism is never the thing you route around.

## Rationalization table

| Excuse | Reality |
|--------|---------|
| "The source is walled — the browser/client can't, so I'll improvise" | The governed real browser IS the wall-clearing mechanism. Use it. If it genuinely cannot, fix the skill — never improvise a side channel. |
| "It's just a quick reconnaissance check" | Reconnaissance is in scope. One bounded browser query, persisted. |
| "It's a public GET / the API is cleaner than a browser" | The uniform mechanism removes the tool-choice that keeps producing lapses. Browser, no exceptions. |
| "A browser is overkill for this one" | "Overkill" is how the exception starts. There are none. |
| "I'll persist it later" | Persist BEFORE analysis. An unsaved page is unverifiable. |
| "I just need to verify one claim" | Verifying a claim IS a source query. Governed browser, persisted. |

## Red flags — STOP

- About to call `WebFetch`, `curl`, `HttpClient`, or `WebSearch`-for-content on a source
- About to make a browser call without saving the page first
- Telling yourself the source is walled / the browser is overkill / it's just a quick check
- About to analyze a page you did not persist

**All of these mean: stop, open the governed browser session, persist the raw page, THEN analyze.**
