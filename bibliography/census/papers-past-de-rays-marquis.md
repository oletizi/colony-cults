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
| 3 (21–30) | 10 | 3 | 3 (early founding-phase 1880/1881 + a 1929 survivor interview) | 7 | bundled mentions now dominate; still new dimensions — continue |
| 4 (31–40) | 10 | 1 | 1 (a comprehensive 11k-char "Story of the Expedition" feature) | 9 | floor — near stop |
| 5 (41–50) | 10 | 0 | 0 (dedicated-title hits were all reprints of T2 canonicals + 1 off-topic) | 10 | floor |
| 6 (51–60) | 10 | 1 | 1 (a distinct London-correspondent trial letter) | 9 | floor (lumpy) |

Trend: distinct yield **5 → 5 → 3 → 1 → 0 → 1**; bundled fraction 0 → ~4 → 7 → 9 → 10 → 9.

**Decay-shape finding (tranches 5–6 were run to test this):** the decline is a *predictable trend* to a low floor, but the floor is **lumpy, not a clean monotonic zero** — distinct pieces keep trickling in sporadically at ~0–1 per tranche (T5=0, T6=1). The reason the floor stays low: by ~tranche 4 the distinct set is largely **saturated**, and deeper "dedicated-title" hits are predominantly *reprints of already-canonical distinct pieces* (e.g. T5 NOT18821127 = a reprint of T2's THD "arch-impostor" feature; T5 ODT18840122 = a reprint of T2's NEM post-conviction summary) interleaved with generic cable-column noise.

**Stopping decision:** stop the exhaustive pagination of the `Marquis de Rays` handle. A full harvest of every remaining distinct piece would mean paginating ~64 more tranches for ~0–1 new items each — poor ROI. The remaining sparse distinct material is better reached with **narrower query handles** (`Port Breton`, `New Ireland`, `Chandernagore`, `La Nouvelle-France`) — never run against Papers Past yet (SRCH-0018) — which target the affair without the cable-column noise. NOTE: post-1920s retrospectives (1929, 1936) do NOT carry the "No known copyright (NZ)" statement — rights must be reconfirmed before any of them can be acquired.

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
11. `BOPT18800930.2.6` — "Settlement in New Ireland": the *Chandernagore* voyage (1880) — T3 — earliest founding-phase report
12. `KUMAT18810202.2.8` — "The Marquis de Ray's New Colony": colony "successfully founded" (1881) — T3 — early founding-phase
13. `ODT19290524.2.100` — 1929 survivor interview (Mr J.O. Mouton, "oldest Papuan planter") — T3 — **rights CHECK (1929)**
14. `NZH18830825.2.51` — "The Story of the Marquis de Rays' Expedition": comprehensive 11k-char narrative (Aug 1883) — T4 — **richest single piece; high value**
15. `NZH18840116.2.52` — "Trial of the Marquis de Rays": distinct London-correspondent trial letter (Dec 1883) — T6

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

## Tranche 3 — results 21–30 (SRCH-0023)

Bundled news-column mentions now dominate (7/10 are generic "Cablegrams" / "Latest" / "Australia" / "News of the World" / "Riots at Beyrout" columns where de Rays is one line). The 3 distinct pieces are the payoff — the first *founding-phase* material (1880–1881) plus a 1929 survivor interview. Only the distinct candidates were content-read (the 7 bundled were classified from metadata + the known pattern).

| # | Code | Masthead | Date | Assessment | Verdict |
|---|---|---|---|---|---|
| 21 | HNS18831201.2.25 | Hawera & Normanby Star | 1883-12-01 | Reuter's cable header; de Rays embedded | skip (bundled) |
| 22 | AG18810411.2.7.2 | Ashburton Guardian | 1881-04-11 | "Australian" news column | skip (bundled) |
| 23 | BOPT18800930.2.6 | Bay of Plenty Times | 1880-09-30 | "Settlement in New Ireland": *Chandernagore* voyage, 1442ch, PD | **ACQUIRE (distinct, earliest)** |
| 24 | KUMAT18810202.2.8 | Kumara Times | 1881-02-02 | "The Marquis de Ray's New Colony" founded, 2746ch, PD | **ACQUIRE (distinct, founding)** |
| 25 | AS18830622.2.12 | Auckland Star | 1883-06-22 | "Latest Cablegrams" column | skip (bundled) |
| 26 | GRA18820818.2.6.1 | Grey River Argus | 1882-08-18 | "Riots at Beyrout" column; de Rays bundled | skip (bundled) |
| 27 | WDT18840103.2.6 | Wairarapa Daily Times | 1884-01-03 | "Cablegrams" column; conviction cable embedded | skip (dup/bundled) |
| 28 | ODT19290524.2.100 | Otago Daily Times | 1929-05-24 | 1929 survivor interview (Mouton), 2138ch, rights CHECK | ACQUIRE? (rights recheck) |
| 29 | TH18831201.2.16 | Taranaki Herald | 1883-12-01 | "News of the World" column | skip (bundled) |
| 30 | SCANT18810412.2.13.2 | South Canterbury Times | 1881-04-12 | "Australia" news column | skip (bundled) |

## Tranche 4 — results 31–40 (SRCH-0024) — final tranche

Floor reached: 8/10 generic cable columns, 1 comprehensive distinct feature, 1 marginal.

| # | Code | Masthead | Date | Assessment | Verdict |
|---|---|---|---|---|---|
| 31 | GLOBE18810416.2.15.2 | Globe | 1881-04-16 | "Australian" column | skip (bundled) |
| 32 | SCANT18810416.2.14.2 | South Canterbury Times | 1881-04-16 | "Australia" column | skip (bundled) |
| 33 | CHP18840507.2.3.2 | Press | 1884-05-07 | "Loss of the S.S. India": ship foundered off NSW; de Rays link tangential, PD | skip (marginal) |
| 34 | MT18840103.2.7 | Manawatu Times | 1884-01-03 | "Very Latest" column; conviction cable | skip (dup/bundled) |
| 35 | MS18831130.2.10 | Manawatu Standard | 1883-11-30 | "Cable News" column | skip (bundled) |
| 36 | PATM18820331.2.14 | Patea Mail | 1882-03-31 | "Second Edition Cable Messages" | skip (bundled) |
| 37 | ST18830804.2.8.2 | Southland Times | 1883-08-04 | "(Special to Press Association)" cable | skip (bundled) |
| 38 | NZH18830825.2.51 | New Zealand Herald | 1883-08-25 | "The Story of the … Expedition": 11082ch comprehensive narrative, PD | **ACQUIRE (distinct, richest)** |
| 39 | WAIST18820815.2.14 | Wairarapa Standard | 1882-08-15 | "News by Cable" column | skip (bundled) |
| 40 | AS18830615.2.31 | Auckland Star | 1883-06-15 | "Latest Cablegrams" column | skip (bundled) |

## Tranches 5–6 — results 41–60 (SRCH-0025) — decay verification

Run specifically to test whether the tail decay is predictable or lumpy. Only the non-generic candidates were content-read; the generic cable columns were classified from metadata.

- **Tranche 5 (41–50): 0 new distinct.** Six generic columns (Intercolonial / War in Egypt / Latest Intelligence / Australian / Australia / Sydney); PATM18820526 "A White Man Among the South Sea Islanders" is off-topic (a Solomon Islands adventure); TS18830202 is a bundled cable column under a de-Rays title; NOT18821127 = reprint of T2's THD "arch-impostor" feature; ODT18840122 = reprint of T2's NEM post-conviction summary.
- **Tranche 6 (51–60): 1 new distinct** — `NZH18840116.2.52` "Trial of the Marquis de Rays" (a distinct London-correspondent trial letter, Dec 1883). The rest are generic columns, an off-topic 1923 item ("Seeing Through Metal"), and a New-Guinea-annexation column with a bundled de-Rays subsection (TH18840104).

## Final shortlist (6 tranches, 60 of 695 assessed)

**15 distinct ACQUIRE candidates** spanning the full arc: founding (1880 *Chandernagore* voyage; 1881 colony founded) → arrest (Aug–Nov 1882) → committal (Feb 1883) → the "Story of the Expedition" feature + the correspondent's trial letter (Aug 1883 / Dec 1883) → conviction (Jan 1884) → the eyewitness Port-Breton visit → retrospectives (1929 survivor interview, 1936). Two (1929, 1936) are **rights-pending** (no "No known copyright (NZ)" statement). See the running shortlist above.

**Coverage note:** 60/695 keyword hits assessed across 6 tranches. The distinct-yield decay (5,5,3,1,0,1) is a predictable trend to a **lumpy floor** of ~0–1 new distinct per tranche — so the tail is not exhausted, just sparse and reprint-saturated. The remaining ~635 hits are NOT covered; harvesting the residual distinct pieces efficiently needs narrower query handles, not exhaustive pagination of this one.

## Provenance

- Enumeration captures: `bibliography/repository-responses/papers-past/papers-past-marquis-de-rays-2026-07-21T00-04-53-834Z.*` (page 1) and `…T00-1*` (page 2, `--page 2`).
- Per-article captures: `bibliography/repository-responses/papers-past-article/papers-past-article-<slug>-2026-07-21T00-07-*` (T1) and `…T00-3*/T00-4*` (T2).
- Unblock (2026-07-21): NZ (Auckland) exit node + cleared a stale Incapsula profile cookie (TASK-44). Multi-page walking now supported in the governed client (`--page N`); the earlier `pages > 1` throw is removed. Governed client only; no side channel.

## Out of scope (explicit)

Full 695-item census beyond the assessed tranches; any acquisition / B2 write; the US (Chronicling America) / Italian (Camera dei Deputati) axes.
