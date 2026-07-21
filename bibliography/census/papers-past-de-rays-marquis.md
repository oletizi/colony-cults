# Papers Past census — "Marquis de Rays" (tranche-by-tranche suitability)

**Source:** Papers Past / National Library of New Zealand (`papers-past`)
**Query:** `Marquis de Rays` — **695 results** (grounded in the persisted results pages)
**Case / scope:** `port-breton` (de Rays / Port-Breton / New Ireland affair)
**Built:** 2026-07-21 (governed `bib query-source` client, spec 014)
**Search-log:** SRCH-0018 (vein), SRCH-0019 (n=1 drill-in), SRCH-0020 (blocked), SRCH-0021 (tranche 1), SRCH-0022 (tranche 2)

## What this is

A **tranche-by-tranche** suitability census of the 695 keyword hits: fetch one result page (10 rows) via the governed client (`--page N`), content-read each, score for corpus suitability, and **reassess the long tail's relevancy after every tranche** to decide whether to keep going. This is a **census + shortlist only** — no acquisition / B2 write; the ACQUIRE/SKIP verdicts are the operator's to act on.

Each row is scored on: **topical** (is the affair the subject, vs a bundled one-line mention), **rights** (NLNZ "No known copyright (NZ)"), **content** (OCR + scans), **novelty** (distinct story vs syndicated reprint of one already assessed).

## Relevancy trend (the stopping signal)

| Tranche | Rows | Dedicated on-topic | New distinct (ACQUIRE) | Reprints/bundled | Verdict |
|---|---|---|---|---|---|
| 1 (1–10) | 10 | 10 | 5 | 5 | rich — continue |
| 2 (11–20) | 10 | ~6 | 4–5 (incl. a unique eyewitness account) | 5 | diluting but still yielding distinct value — continue |

Stop when a tranche yields ~no new distinct on-topic material (mostly reprints / bundled mentions / off-topic).

## Running ACQUIRE shortlist (distinct stories, across tranches)

1. `HNS18840103.2.19.3` — Conviction cable (canonical of a 5-masthead 1884 reprint set) — T1
2. `NZH18821021.2.58` — Arrest + emigrant backstory long-form (canonical) — T1
3. `MDTIM18821023.2.16` — "In gaol": richest Port-Breton / Italian-immigrant context — T1
4. `AS18820814.2.28.2` — Earliest arrest cable (London, 13 Aug 1882) — T1
5. `MEX18830202.2.11` — Committed-for-trial cable (Feb 1883) — T1
6. **`BH18821020.2.22.3` — EYEWITNESS account of visiting Port Breton (Rev. I. Rooney, in the Beagle) — T2 — unique primary source, high value**
7. `GRA18830813.2.16` — "A Nobleman's Swindling Scheme" (trial postponed, Aug 1883) — T2
8. `THD18821124.2.27` — Long distinct feature ("arch-impostor", Paris correspondent) — T2
9. `NEM18840126.2.19` — Fuller post-conviction retrospective (Jan 1884) — T2
10. `ODT19360718.2.13.7.1` — 1936 retrospective (distinct era) — T2 — **recheck: thin capture (19 ch), rights unconfirmed for 1936**

## Tranche 1 — results 1–10 (SRCH-0021)

All 10 on-topic, public-domain, content-complete; 5 distinct after stripping syndication.

| # | Code | Masthead | Date | Cluster | Verdict |
|---|---|---|---|---|---|
| 1 | HNS18840103.2.19.3 | Hawera & Normanby Star | 1884-01-03 | Conviction cable (canonical) | ACQUIRE |
| 2 | NZH18821021.2.58 | New Zealand Herald | 1882-10-21 | Arrest long-form (canonical) | ACQUIRE |
| 3 | MDTIM18821023.2.16 | Marlborough Daily Times | 1882-10-23 | distinct (richest) | ACQUIRE |
| 4 | AS18820814.2.28.2 | Auckland Star | 1882-08-14 | distinct (earliest) | ACQUIRE |
| 5 | MEX18830202.2.11 | Marlborough Express | 1883-02-02 | distinct (committal) | ACQUIRE |
| 6 | DTN18840103.2.17.3 | Daily Telegraph (Napier) | 1884-01-03 | Conviction reprint | skip (dup) |
| 7 | MEX18840103.2.8 | Marlborough Express | 1884-01-03 | Conviction reprint | skip (dup) |
| 8 | MS18840103.2.34 | Manawatu Standard | 1884-01-03 | Conviction reprint | skip (dup) |
| 9 | TS18840103.2.9.1 | Star (Christchurch) | 1884-01-03 | Conviction reprint | skip (dup) |
| 10 | HBH18821116.2.17 | Hawke's Bay Herald | 1882-11-16 | Arrest long-form reprint of #2 | skip (dup) |

Conviction cable (canonical HNS) = #1,6,7,8,9. Arrest long-form (canonical NZH) = #2,10. Distinct singles = #3 (MDTIM), #4 (AS), #5 (MEX-1883).

## Tranche 2 — results 11–20 (SRCH-0022)

Relevancy diluting: reprints of the T1 arrest/conviction clusters now recur, and news-column bundled mentions appear — but four to five genuinely distinct pieces, including a unique eyewitness account.

| # | Code | Masthead | Date | OCR | Assessment | Verdict |
|---|---|---|---|---|---|---|
| 11 | ODT19360718.2.13.7.1 | Otago Daily Times | 1936-07-18 | 19ch | 1936 retrospective; distinct era but thin capture, rights unconfirmed | ACQUIRE? (recheck) |
| 12 | GRA18830813.2.16 | Grey River Argus | 1883-08-13 | 1306ch | "A Nobleman's Swindling Scheme" — de Rays the subject; trial postponed | ACQUIRE (distinct) |
| 13 | BH18821020.2.22.3 | Bruce Herald | 1882-10-20 | 880ch | EYEWITNESS visit to Port Breton (Rev. Rooney, the Beagle) — unique | **ACQUIRE (distinct, high value)** |
| 14 | NEM18840126.2.19 | Nelson Evening Mail | 1884-01-26 | 3344ch | Fuller post-conviction retrospective of the whole affair | ACQUIRE (distinct) |
| 15 | THD18821124.2.27 | Timaru Herald | 1882-11-24 | 5173ch | Long feature ("arch-impostor", Paris correspondent) | ACQUIRE (distinct) |
| 16 | EP18830615.2.22 | Evening Post | 1883-06-15 | 1279ch | Telegraph column; de Rays one item among several | skip (bundled) |
| 17 | SCANT18840103.2.11.3 | South Canterbury Times | 1884-01-03 | 481ch | Conviction cable inside a "Very Latest" column | skip (dup) |
| 18 | WH18820814.2.13 | Wanganui Herald | 1882-08-14 | 581ch | Aug-1882 arrest cable bundled in "Argus Specials" (Garibaldi etc.) | skip (dup/bundled) |
| 19 | EP18821104.2.27 | Evening Post | 1882-11-04 | 4771ch | Verbatim reprint of the NZH arrest long-form | skip (dup) |
| 20 | IT18821122.2.7 | Inangahua Times | 1882-11-22 | 2729ch | Verbatim reprint of the NZH arrest long-form | skip (dup) |

All 10 carry "No known copyright (NZ)" except #11 (1936; unconfirmed — recheck before any acquisition).

## Provenance

- Enumeration captures: `bibliography/repository-responses/papers-past/papers-past-marquis-de-rays-2026-07-21T00-04-53-834Z.*` (page 1) and `…T00-1*` (page 2, `--page 2`).
- Per-article captures: `bibliography/repository-responses/papers-past-article/papers-past-article-<slug>-2026-07-21T00-07-*` (T1) and `…T00-3*/T00-4*` (T2).
- Unblock (2026-07-21): NZ (Auckland) exit node + cleared a stale Incapsula profile cookie (TASK-44). Multi-page walking now supported in the governed client (`--page N`); the earlier `pages > 1` throw is removed. Governed client only; no side channel.

## Out of scope (explicit)

Full 695-item census beyond the assessed tranches; any acquisition / B2 write; the US (Chronicling America) / Italian (Camera dei Deputati) axes.
