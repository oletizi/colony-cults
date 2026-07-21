# Papers Past census — "Marquis de Rays" (top-10 suitability)

**Source:** Papers Past / National Library of New Zealand (`papers-past`)
**Query:** `Marquis de Rays` — **695 results** (grounded in the persisted results page)
**Case / scope:** `port-breton` (de Rays / Port-Breton / New Ireland affair)
**Built:** 2026-07-21 (governed `bib query-source` client, spec 014)
**Search-log:** SRCH-0018 (vein), SRCH-0019 (n=1 drill-in), SRCH-0020 (blocked), **SRCH-0021 (this census)**

## What this is

A bounded, deduplicated suitability census of the **top 10** first-page results — NOT the full 695 (that keyword count includes heavy cross-masthead syndication). Each of the 10 was content-read through the governed `papers-past-article` client and scored for corpus suitability. This is a **census + shortlist only**: no acquisition / B2 write was performed here; the acquire/skip verdicts are the operator's to act on separately.

## Method

1. **Enumerate** — one governed `bib query-source papers-past --query "Marquis de Rays"`; top result page = 10 discrete article rows (code, masthead, date). Raw page persisted.
2. **Triage** — all 10 titles were plausibly on-topic (arrest / conviction / sentence / fraud / gaol); none dropped.
3. **Content-read** — all 10 read via `bib query-source papers-past-article --query <code>` (persist-first); topical text, rights statement, OCR length, and scan presence taken from each persisted capture.
4. **Score** — topical / rights / content / novelty (syndication cluster).

## Assessment

| # | Article code | Masthead | Date | Topical | Rights | OCR | Scans | Cluster | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | HNS18840103.2.19.3 | Hawera & Normanby Star | 1884-01-03 | ✅ | No known copyright (NZ) | 420 | ✅ | **Conviction cable** (canonical) | **ACQUIRE** |
| 2 | NZH18821021.2.58 | New Zealand Herald | 1882-10-21 | ✅ | No known copyright (NZ) | 2695 | ✅ | **Arrest long-form** (canonical) | **ACQUIRE** |
| 3 | MDTIM18821023.2.16 | Marlborough Daily Times | 1882-10-23 | ✅ | No known copyright (NZ) | 4490 | ✅ | distinct (richest) | **ACQUIRE** |
| 4 | AS18820814.2.28.2 | Auckland Star | 1882-08-14 | ✅ | No known copyright (NZ) | 689 | ✅ | distinct (earliest) | **ACQUIRE** |
| 5 | MEX18830202.2.11 | Marlborough Express | 1883-02-02 | ✅ | No known copyright (NZ) | 223 | ✅ | distinct (committal) | **ACQUIRE** |
| 6 | DTN18840103.2.17.3 | Daily Telegraph (Napier) | 1884-01-03 | ✅ | No known copyright (NZ) | 506 | ✅ | Conviction cable (reprint) | skip (dup) |
| 7 | MEX18840103.2.8 | Marlborough Express | 1884-01-03 | ✅ | No known copyright (NZ) | 467 | ✅ | Conviction cable (reprint) | skip (dup) |
| 8 | MS18840103.2.34 | Manawatu Standard | 1884-01-03 | ✅ | No known copyright (NZ) | 524 | ✅ | Conviction cable (reprint) | skip (dup) |
| 9 | TS18840103.2.9.1 | Star (Christchurch) | 1884-01-03 | ✅ | No known copyright (NZ) | 486 | ✅ | Conviction cable (reprint) | skip (dup) |
| 10 | HBH18821116.2.17 | Hawke's Bay Herald | 1882-11-16 | ✅ | No known copyright (NZ) | 2714 | ✅ | Arrest long-form (reprint of #2) | skip (dup) |

All 10 are on-topic, public-domain, and content-complete (OCR + page scans). The only axis that separates them is **novelty** — the SKIP rows are syndicated reprints, not unsuitable material.

## Syndication clusters

- **Conviction cable (3 Jan 1884)** — #1, 6, 7, 8, 9 are the same Reuters/Paris (Jan 2) cable ("found guilty… four years… fine of 3000 francs… associates also convicted"), reprinted across five mastheads on one day. **Canonical: #1 HNS** (already validated end-to-end in SRCH-0019; clean short exemplar).
- **Arrest long-form (Oct–Nov 1882)** — #2 (NZH) and #10 (HBH) share verbatim-identical opening text; same syndicated background piece. **Canonical: #2 NZH** (larger masthead, earlier date).
- **Distinct single-witness pieces** — #3 MDTIM (unique long treatment: Port Breton, the two shiploads of Italian immigrants, the Paris correspondent), #4 AS (earliest report — London 13 Aug 1882 arrest cable, bundled in "Special Dispatches"), #5 MEX-1883 (committal-for-trial cable, Feb 1883).

## Shortlist

**ACQUIRE (5 distinct underlying stories):**
1. `HNS18840103.2.19.3` — Conviction (canonical of the 5-reprint 1884 cable)
2. `NZH18821021.2.58` — Arrest + emigrant backstory (canonical of the 2-reprint long-form)
3. `MDTIM18821023.2.16` — "In gaol" — richest Port-Breton / Italian-immigrant context
4. `AS18820814.2.28.2` — Earliest arrest cable (Aug 1882)
5. `MEX18830202.2.11` — Committed for trial (Feb 1883)

Together these span the affair's NZ-press arc — earliest arrest → arrest/backstory → committal → conviction — with no redundant reprints.

**SKIP (5 syndicated reprints — available if a syndication/reach witness is later wanted):**
`DTN18840103.2.17.3`, `MEX18840103.2.8`, `MS18840103.2.34`, `TS18840103.2.9.1` (conviction-cable reprints); `HBH18821116.2.17` (arrest long-form reprint of #2).

## Provenance

- Enumeration capture: `bibliography/repository-responses/papers-past/papers-past-marquis-de-rays-2026-07-21T00-04-53-834Z.{html,md}`
- Per-article captures: `bibliography/repository-responses/papers-past-article/papers-past-article-<slug>-2026-07-21T00-07-*.{html,md}` (one per code above)
- Unblock: the query had been WAF-blocked (SRCH-0020); cleared 2026-07-21 by routing through an NZ (Auckland) exit node **and** clearing a stale Incapsula session cookie from the client's persistent browser profile (root cause of TASK-44). The governed client was the only mechanism used throughout; no side channel.

## Out of scope (explicit)

Full 695-item census; syndication de-duplication beyond the top 10; any acquisition / B2 write; the US (Chronicling America) / Italian (Camera dei Deputati) axes.
