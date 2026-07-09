# Design Guidance: Handling PB-P004 and Multi-Document Historical Sources

> Captured 2026-07-09 as operator design guidance. NOT yet designed/implemented —
> to be taken up in a dedicated design session (introduce a Source / Source-Group /
> Repository-Record model; reclassify PB-P004 as the project's first Source Group).
> Verbatim as provided by the operator.

**Status:** Recommendation

**Audience:** Engineering, Product, and Research

---

## Summary

PB-P004 should **not** be treated as a fetchable source.

It is currently a **placeholder describing a body of evidence**, not a specific historical document.

Attempting to fetch it directly will inevitably fail because it has no stable archival identity.

Instead, treat it as a **Source Group** whose members are discovered over time.

---

## Current State

Current metadata:

```yaml
sourceId: PB-P004
kind: monograph
creator: various
title: French trial and legal proceedings relating to the Marquis de Rays
repository: Gallica / BnF
status: to-collect
```

This record does **not** identify a real archival object. It identifies a research objective.

---

## Problem

The current model assumes every PB identifier represents a single fetchable work. That assumption is false.

Many historical sources are actually collections:

- trial proceedings
- correspondence
- newspaper coverage
- parliamentary debates
- archival files
- manuscript collections

These must first be discovered before they can be acquired.

---

## Recommendation

Reclassify PB-P004 as a **Source Group**. Instead of representing one document, it represents the complete legal corpus surrounding the Marquis de Rays prosecution.

---

## Proposed Model

```
PB-P004
├── PB-P004-001  Court indictment
├── PB-P004-002  Trial proceedings
├── PB-P004-003  Sentencing
├── PB-P004-004  Appeal
└── PB-P004-005  Government report
```

Each child becomes an independently fetchable source.

---

## Acquisition Strategy

Do **not** fetch PB-P004. Instead:

### Phase 1 — Discovery

Search Gallica/BnF for candidate legal records. Suggested searches:

```
marquis de Rays procès
du Breil de Rays procès
Port-Breton procès
Nouvelle-France escroquerie
marquis de Rays tribunal
marquis de Rays cour d'assises
```

For every candidate record: title, creator, publication date, ARK, repository, rights, notes, relevance. No downloading yet.

### Phase 2 — Inventory

Create an inventory. Example:

```yaml
PB-P004-001
title:
creator:
ark:
repository:
rights:
status: discovered
```

This is now a real source.

### Phase 3 — Verification

Verify rights, completeness, duplicate scans, archival identity. Only then promote to:

```yaml
status: approved-for-acquisition
```

### Phase 4 — Acquisition

Once approved, the normal acquisition pipeline applies: download, checksum, OCR, provenance, metadata, archive mirror.

---

## Newspaper Coverage

Newspaper reports of the trial should **not** become PB-P004. They belong in the newspaper series (e.g. `PB-N001`, `PB-N002`, `PB-N003`). The legal corpus and the journalistic corpus are different evidence classes.

---

## Candidate Sources

One nearby lead already exists:

```
ark:/12148/bpt6k5785971m
```

However, this appears to be a later historical account, not necessarily one of the original court records. Treat it as `Candidate / Needs verification`, not automatically as PB-P004.

---

## Design Improvement

This exposes a broader modeling issue. Not every source is one document. The metadata model should distinguish:

- **Source** — one intellectual work (book, pamphlet, newspaper issue).
- **Source Group** — a research-defined collection of related works (trial corpus, correspondence, missionary archives, parliamentary papers, photograph collection). Source Groups are containers; they are never directly fetched.
- **Repository Record** — one archive's digital representation (Gallica, Internet Archive, HathiTrust, State Library of Queensland).

---

## Agent Behavior

If a Source Group is encountered, the agent should:

1. discover candidate members
2. inventory candidates
3. verify archival identity
4. create child records
5. fetch only child records

The agent should never attempt to fetch the Source Group itself.

---

## General Rule

If a source lacks an ARK, DOI, ISBN, OCLC, repository identifier, or another stable archival identity, it should be assumed to require **discovery**, not acquisition.

---

## Future Work

The metadata schema should introduce:

```yaml
kind:
  source
  source-group
  repository-record
```

This allows the acquisition engine to behave correctly without relying on naming conventions.

---

## Recommendation

Treat PB-P004 as the project's first **Source Group**. This establishes a reusable pattern for future collections such as correspondence, government archives, missionary papers, newspaper series, photograph collections, personal papers.

The resulting acquisition pipeline becomes:

```
Discover → Inventory → Verify → Promote → Acquire → Preserve
```

rather than attempting to fetch an ill-defined collection as though it were a single document.
