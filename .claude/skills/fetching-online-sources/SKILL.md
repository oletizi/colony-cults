---
name: "fetching-online-sources"
description: "Use when about to make ANY HTTP request to an external online source or repository during corpus work — discovery search, reconnaissance, metadata lookup, OCR read, or asset download (Gallica, Internet Archive, Trove, Papers Past, Chronicling America, library/museum/newspaper portals, or any source website whose content you will cite). Trigger symptoms of an imminent violation: reaching for WebFetch, WebSearch-to-fetch-content, or curl on a source URL; fetching a page you will not save; telling yourself 'it is just a quick public GET'."
metadata:
  author: "colony-cults"
  enforces: "constitution Principle XII (Respect the Source); DECISIONS.md store-raw-responses"
user-invocable: true
disable-model-invocation: false
---

# Fetching Online Sources (Frugal, Polite Access)

## Overview

Every request to an external source/repository during corpus work MUST go through the shipped rate-limited client AND MUST persist its raw response before analysis. This operationalizes constitution **Principle XII** (Respect the Source) + the DECISIONS.md store-raw-responses convention. External archives (Gallica, Internet Archive, Trove, Papers Past, Chronicling America, museum/library portals) have hair-trigger rate limits and finite goodwill — a wasted or impolite request risks the block that ends the work.

**Violating the letter of this rule is violating the spirit of it.**

## The mandate (non-negotiable)

1. **Politeness — the shipped client, never an ad-hoc tool.** All source HTTP goes through `src/gallica/http-client.ts` `HttpClient` (descriptive contactable User-Agent, ~1 req/s, exponential backoff, honors Retry-After). NEVER `curl`, `WebFetch`, or `WebSearch`-to-fetch-content against a source URL — each bypasses the politeness envelope.
2. **Frugality — persist before analysis.** Write each raw response under `bibliography/repository-responses/<source>/` BEFORE parsing it. Raw repository data is precious; never analyze a response you did not save. Waived only per-source when a ToS forbids retention (e.g. Trove — see DECISIONS.md); then record derived facts + attribution instead.
3. **Never waste a request.** No estimate-only dry-run that pings then discards. Reconnaissance uses the narrowest bounded calls. A "dry run" downloads once, keeps locally, verifies, uploads only if good.
4. **Verify claims against persisted evidence.** Every fact you put in the search-log must be grep-traceable in a persisted response. An unpersisted snippet is unverifiable — never rest a claim on it.
5. **Disclose lapses.** If you slip, disclose + remediate in the search-log note (SRCH-00NN): re-fetch through the client, persist, re-verify.

## The compliant recipe

Write a one-off discovery script (scratchpad, NOT committed — per the SRCH-0014/0015 precedent) that: constructs the source's native API/query URL; fetches each via `new HttpClient({ userAgent: '...(research; contact ...)' })`; writes the raw body under `bibliography/repository-responses/<source>/` BEFORE any parsing; prints a compact summary for offline analysis.

`WebSearch` is allowed for INITIAL lead-discovery only (finding what/where exists) — never to pull source content, OCR, metadata, or any page you will cite.

## Rationalization table

| Excuse | Reality |
|--------|---------|
| "It's a public GET endpoint" | Still a source with finite goodwill; still bypasses the envelope. Route it through the client. |
| "It's just a quick reconnaissance check" | Reconnaissance is explicitly in scope (Principle XII). Narrowest bounded calls, through the client. |
| "WebFetch/curl is right there / easier" | Ease is the trap. The client is one small script. |
| "The source didn't rate-limit me" | You can't predict the trigger — a baseline agent got 403/503 from LoC on a 'quick' pass. |
| "I'll persist it later" | Persist BEFORE analysis. A response you analyzed but didn't save is unverifiable. |
| "It's a search engine, not the source" | WebSearch for leads is fine; fetching source CONTENT is not. |

## Red flags — STOP

- About to type `curl` against a source URL
- About to call `WebFetch` on a repository/source page
- About to call `WebSearch` to pull article / OCR / metadata content
- About to analyze a response you did not save to disk
- Telling yourself "just this once, it's a quick check"

**All of these mean: stop, write the HttpClient script, persist the raw response before analyzing it.**
