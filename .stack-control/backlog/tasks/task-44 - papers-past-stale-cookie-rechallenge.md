---
id: TASK-44
title: papers-past-stale-cookie-rechallenge
status: To Do
assignee: []
created_date: '2026-07-19 06:09'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - src/repository/papers-past/adapter.ts
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A repeat bib acquire of a Papers Past article gets WAF-challenged: the persistent Playwright profile's Incapsula cookies go stale, so navigate returns a ~996-byte challenge interstitial (no canonical link) and the adapter fail-loud rejects it (not-an-article-page). Confirmed live: the first acquire succeeded, immediate re-runs were challenged, and clearing the browser profile (fresh challenge-solve) fixed it. Manual workaround: rm the tmp browser-profile before re-acquiring. Robustness fix: the adapter/session should detect a challenge page and clear+re-solve (or refresh the session/cookies per acquire) rather than fail-loud on a stale-cookie interstitial, so batch/repeat acquisition works unattended.

ADDENDUM (2026-07-21, SRCH-0020 -> SRCH-0021): this is NOT acquire-only -- it hit the QUERY path too and blocked the top-10 census for a full day. `bib query-source` (SourceQueryClient via src/sourcequery/browser-session-playwright.ts, the same persistent profile at os.tmpdir()/corpus-gap-closure/browser-profile) hard-403'd BOTH the original residential IP and a fresh NZ exit-node IP, because the profile replayed a stale Incapsula session cookie (incap_ses_249_141415 with expiry 1601-01-01 + visid_incap_141415 from the 2026-07-18 success). Root cause is therefore CONFIRMED (was "likely" in SRCH-0020) and lives in the shared browser session, not the acquire adapter -- so the robustness fix belongs in the SourceQueryClient/PlaywrightBrowserSession layer and covers query, content-read, AND acquire. Extend `references` to src/sourcequery/browser-session-playwright.ts and src/sourcequery/source-query-client.ts. Manual workaround (delete the profile dir before the run) unblocked the census this session.
<!-- SECTION:DESCRIPTION:END -->
