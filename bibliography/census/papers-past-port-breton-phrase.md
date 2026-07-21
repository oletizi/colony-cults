# Papers Past census — vein: `"Port Breton"` (quoted phrase)

**Source:** Papers Past / National Library of New Zealand (`papers-past`)
**Query:** `"Port Breton"` (quoted **phrase** — the token form is Cape-Breton-polluted; see SRCH-0030) — **202 hits**
**Case / scope:** `port-breton`
**Built:** 2026-07-21 (governed `bib query-source` client, spec 014)
**Search-log:** SRCH-0031+
**Sibling veins:** `Marquis de Rays` (28 distinct PD, depleted) + `Rabardy` (2 distinct PD). This vein's "distinct" = pieces NOT already in that combined 30-item shortlist.

## Method

Same tranche-by-tranche process (fetch `--page N`, metadata-triage, content-read the non-generic/not-already-found candidates, score), continuing to **two consecutive zero-NEW-distinct tranches**. Because the top hits are all on-topic (phrase search), "distinct" here is scored as **NEW** (not a re-find of an already-banked piece, not a reprint, not a bundled mention).

## Relevancy / new-distinct trend

| Tranche | Rows | New distinct | Notes |
|---|---|---|---|
| 1 (1–10) | 10 | 1 | the **New Italy** aftermath: "A Page of History" (1923 syndicated across 5+ papers) — the de Rays survivors' NSW settlement. Rest = re-finds (Deluded Frenchmen, Swindling Scheme, Story of the Expedition, Colonisation Swindle). |
| 2 (11–20) | 10 | 2 | **earliest material yet**: "New Guinea and the Chandernagore" (Oct 1879 — the Geneva recruitment ads / pre-departure); "New Ireland Colonization Scheme" (Sep 1880, Shuter traveler report). Rest re-finds + a 1936 "Phantom Paradise" review (rights-blocked). |
| 3 (21–30) | 10 | 3 | the captain's story of the Chandernagore (Apr 1880); "The New Ireland Expedition" (SMH Aug 1880); "The New Ireland Colonists" (Apr 1881 — Italian colonists via the *India* → Noumea → Sydney, the New Italy pipeline). |

## New distinct ACQUIRE candidates (this vein)

- `CHP19231106.2.73` (+ EP19231103 / FRTIM19231207 / ODT19231102 / WAIPO19231110 / WH19231114 reprints) — **"A Page of History: Italian Settlement in NSW / New Italy"** (1923) — the survivors' Richmond-River settlement, the affair's aftermath/legacy. **Rights CHECK (1923).** Connects to the existing New Italy thread (backlog TASK-34).
- `HBH18791028.2.15` — "New Guinea and the Chandernagore" (Oct **1879**, PD) — EARLIEST: first reports of the "mysterious French barque" + the Geneva recruitment advertisements (pre-departure).
- `AS18800917.2.29` — "New Ireland Colonization Scheme" (Sep 1880, PD) — Shuter traveler report; Rabardy + the *Genil*.
- `PBH18800405.2.18` — "The Chandernagore Expedition" (Apr 1880, PD) — the captain's first-person story.
- `LT18800906.2.37` — "The New Ireland Expedition" (Sep 1880, PD) — SMH (Aug 14) on the persistence after the first failure.
- `LT18810421.2.31` — "The New Ireland Colonists" (Apr 1881, PD, 8758ch) — the Italian colonists via the *India* → Noumea (starving) → Sydney; the New Italy pipeline.

## Provenance / method

Governed `bib query-source` client only (persist-first); phrase enumeration via `--page`; content-reads via `papers-past-article`. NZ exit node + warm profile carried over. Census + shortlist only. Captures under `bibliography/repository-responses/papers-past{,-article}/` (2026-07-21).
