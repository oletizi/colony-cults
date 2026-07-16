# PB-P002 discovery-lead resolution — Gallica captures (2026-07-16)

Raw Gallica responses captured while resolving the not-held Port-Breton affair
imprints surfaced as discovery leads under **SRCH-0008** (the PB-P002 × BnF
catalogue search). These works are DISTINCT from PB-P002 itself (the held 1879
de Rays prospectus, `bpt6k58039518`); they are filed here because SRCH-0008 —
PB-P002's discovery thread — surfaced them.

**Retrieval method:** Gallica SRU (`gallica.bnf.fr/SRU`) and OAIRecord
(`gallica.bnf.fr/services/OAIRecord`), fetched through the shipped polite
`HttpClient` (`@/gallica/http-client`: descriptive User-Agent, ~1 req/s pacing,
403-backoff) — never raw curl. Fetched from a France (Paris) Tailscale exit
node during one grace window; every raw body was written to disk before parsing,
and all analysis was done offline against these files.

**Retrieved:** 2026-07-16.

## Captures

| File | Query / ARK | Measured result |
|------|-------------|-----------------|
| `sru-degroote-nouvelle-france-2026-07-16.xml` | SRU `dc.title all "Nouvelle-France colonie libre Port-Breton"` | 6 records — all already-held works (PB-P001/002/003/009/011); **de Groote's 1880 368p book NOT among them** |
| `sru-degroote-colonisation-agricole-2026-07-16.xml` | SRU `dc.title all "Port-Breton colonisation agricole"` | **0 records** — confirms the de Groote 1880 book (`cb34944911d`) is not digitised on Gallica |
| `sru-bureau-de-paris-2026-07-16.xml` | SRU `dc.title all "Colonie libre Port-Breton Bureau de Paris"` | **0 records** — lead `cb34139874n` (Schiller, 1881) not digitised on Gallica |
| `sru-expose-sommaire-2026-07-16.xml` | SRU `dc.title all "Colonie libre Port-Breton Exposé sommaire"` | **0 records** — lead `cb33311782v` (Blanc et Bernard, Marseille, 1881) not digitised on Gallica |
| `sru-charbonnier-canne-sucre-2026-07-16.xml` | SRU `dc.title all "Exploitation canne sucre Port-Breton"` | **0 records** — lead `cb302225480` (Charbonnier, 1879, 7p) not digitised on Gallica |
| `sru-carte-map-2026-07-16.xml` | SRU `dc.title all "Carte Nouvelle France Port Breton"` | 2 records — the 1686 Franquelin map + the 1881 Auxais map (`btv1b10870266z`), the digitisation of lead `cb38797788d` |
| `oai-map-btv1b10870266z-2026-07-16.xml` | OAIRecord `btv1b10870266z` | Auxais, 1881; **rights = "conditions spécifiques d'utilisation - Société de Géographie" / "restricted use"**; `streamable=false`; `dc:relation` links catalogue notice `cb38797788d` → known-but-restricted, not mirrorable |

## Cross-referenced capture (filed under PB-P003)

| File | ARK | Measured result |
|------|-----|-----------------|
| `../PB-P003/oai-bpt6k58017546-2026-07-16.xml` | OAIRecord `bpt6k58017546` | Baudouin, *L'aventure de Port-Breton*, 1883, `domaine public`, **Nombre total de vues: 395** — matches PB-P003's 395 archived masters exactly; resolves PB-P003's previously-missing Gallica document ark |

## Verdict

Of the five not-held leads: four have no Gallica digitisation (measured
negatives — pursue on non-Gallica repositories: archive.org / Google Books /
HathiTrust), and one (the map) is digitised but rights-restricted. **Zero
acquirable via the Gallica pipeline.** The pass grew corpus *knowledge*, not the
held corpus; the one durable SSOT gain is PB-P003's resolved ark.
