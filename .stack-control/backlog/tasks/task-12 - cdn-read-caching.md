---
id: TASK-12
title: cdn-read-caching
status: To Do
assignee: []
created_date: '2026-07-09 21:56'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Put a CDN (Cloudflare or Fastly, via Backblaze's Bandwidth Alliance) in front of the PUBLIC colony-cults B2 bucket for the READ/consumption side of the archive: cache hits are served from the edge and never touch B2, so they incur no Class B (download) transaction and no egress charge (B2->Cloudflare egress is free). Design: reads resolve through a cached public domain (custom domain CNAME'd to the bucket, Cloudflare proxy + cache TTL + invalidation on overwrite); writes (PutObject, Class A) and --verify talk to B2 DIRECTLY (never through the cache, or --verify checks stale edge state and the integrity guarantee is defeated). Motivation: the un-raisable daily Class B transaction cap. NOT needed for acquisition (trust-local + Class A uploads already sidesteps it; capture reads nothing from B2). Pays off when researchers/downstream tools read masters repeatedly; cold/one-off reads of unique objects still cost one Class B each (cache miss). Treat as a deliberate serve-the-archive project, not a quick fix.
<!-- SECTION:DESCRIPTION:END -->
