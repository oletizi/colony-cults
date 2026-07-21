# Papers Past census — pivot vein: `Rabardy` (+ handle-selection findings)

**Source:** Papers Past / National Library of New Zealand (`papers-past`)
**Case / scope:** `port-breton` (de Rays / Port-Breton / New Ireland affair)
**Built:** 2026-07-21 (governed `bib query-source` client, spec 014)
**Search-log:** SRCH-0029
**Predecessor vein:** `Marquis de Rays` — DEPLETED at 19 tranches, 28 distinct PD (see `papers-past-de-rays-marquis.md`)

## Handle-selection findings (why `Rabardy`)

After depleting `Marquis de Rays`, the plan was to pivot to a "narrower, cleaner" handle. Testing showed the affair's **place/ship names are homonym-polluted** and are actually *noisier* than the person's name:

| Handle | Count | Verdict |
|---|---|---|
| `Port Breton` | 9593 | **Rejected** — dominated by "Cape Breton" (Nova Scotia) + generic "port"/"Breton" token matches; only ~4/10 top hits on-topic, 3 of them already in the `Marquis de Rays` census. |
| `Chandernagore` | 649 | **Rejected** — every top hit is the *Indian city* Chandernagore (the French enclave near Calcutta, its 1949–50 merger with India), not the de Rays ship named after it. |
| `Rabardy` | 14 | **Selected** — Commodore Rabardy governed the colony and died at Port Breton; his surname is rare and non-homonymous, so every hit is colony-internal on-topic. Surfaces material the title/person search missed (pieces framed on "du Breil" / "colonisation swindle"). |

**Lesson:** for this affair the person's distinctive name (`Marquis de Rays`) was the *cleanest* high-yield handle; the useful complements are other **distinctive associated proper nouns** (`Rabardy`, and next `du Breil` / `Charles du Breil` — de Rays' real name), NOT the place/ship names.

## Rabardy census (14 hits, complete)

Distinct-yield curve: **2, 0** (tranche 1 = results 1–10, tranche 2 = results 11–14). Fully covered — the whole 14-hit vein assessed.

**New distinct PD ACQUIRE (2):**
- `CHP18980101.2.78` — **"The South Sea Bubble of Charles du Breil"** (Press, 1 Jan 1898, 15689ch, PD) — a comprehensive retrospective feature via the London Standard ("By A South Sea Trader"), under de Rays' real name. **Missed by the person-name search; high value.**
- `NZH18821216.2.76` — **"The French Colonisation Swindle — Trial of the Marquis de Rays"** (NZ Herald, 16 Dec 1882, 8687ch, PD) — an SMH-Paris-correspondent feature on the pending trial of "M. du Breil".

**Not new / skip:**
- `ESD18840222.2.16`, `SCANT18840227.2.17`, `WEST18831120.2.14`, `NEM18831105.2.18` — reprints of the Dr Baudoin "French Mode of Annexing" account (already census #22 from the `Marquis de Rays` vein).
- `MPRESS18831122.2.24` (foreign-news column: Hawaii, Annam blockade), `MH18940421.2.18` (general 1894 Paris letter), `AG18831029.2.9` (a Dunedin libel-case editorial), `ODT18831030.2.9` + `NZH18831022.2.14` (long multi-topic editorial pages, de Rays buried), `OW18831103.2.25` ("Local & General") — bundled mentions.
- `EP19041001.2.101` ("The Story-Teller. The Awful Duel on Ulund") — 1904 fiction, off-topic.

## Combined shortlist status (across both veins)

**30 distinct PD ACQUIRE candidates** for the de Rays / Port-Breton case: 28 from `Marquis de Rays` (see that doc) + 2 from `Rabardy` (above). Plus rights-blocked/pending retrospectives (1929/1936/1949). The 1898 "South Sea Bubble" retrospective is a standout addition.

## Next promising handle

`du Breil` / `Charles du Breil` (de Rays' real name) — should surface real-name-framed coverage (like the 1898 "South Sea Bubble" piece) that the title search deprioritized. Also `United Brotherhood` (the colonists' self-name, per the 1898 feature). Same tranche process, if the operator wants to continue.

## Provenance / method

Governed `bib query-source` client only (persist-first). Handle tests + Rabardy enumeration via `--page`; per-article content-reads via `papers-past-article`. NZ exit node + warm profile carried over from SRCH-0021. Census + shortlist only — no acquisition / B2 write. Captures under `bibliography/repository-responses/papers-past{,-article}/` (2026-07-21).
