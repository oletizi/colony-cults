---
id: TASK-2
title: census-date-validation
status: To Do
assignee: []
created_date: '2026-07-08 14:28'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
normalizeFrenchDate does not validate the parsed day against month/year; an impossible label (e.g. '31 fevrier 1879' or a bad Gallica date) can produce an invalid YYYY-MM-DD that persists into research metadata. Fix: round-trip-check a UTC date after parsing (incl leap-year), throw on mismatch. (govern MEDIUM)
<!-- SECTION:DESCRIPTION:END -->
