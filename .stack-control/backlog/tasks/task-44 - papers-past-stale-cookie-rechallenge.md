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
<!-- SECTION:DESCRIPTION:END -->
