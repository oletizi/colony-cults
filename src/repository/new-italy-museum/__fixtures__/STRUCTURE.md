# Musarch item-page structure (ground truth)

Captured from real New Italy Museum catalogue pages (`newitaly.org.au/CAT/NNNNNN.htm`, Musarch software export) 2026-07-14. Fixtures: `musarch-000844.html` (Pioneers Group Photo 1890 — has an image), `musarch-000855.html` (Survivors arrival in Sydney 1881 — artist's impression, NO downloadable image).

## Item URL pattern
`https://newitaly.org.au/CAT/NNNNNN.htm` (six-digit id). Item pages found via `objindexbycat.htm` / `objindexbyname.htm`.

## Mechanical fields (DOM-direct — deterministic)
Each detail field is `<span class="data" id="objectXXX"> VALUE</span>` inside `#objectdetails`:
- `#objectid` → e.g. `000844` (the six-digit page id).
- `#objectaccession` → e.g. `NIMI-0844` (**the durable copy identity** — maps to the `accession` copy identifier).
- `#objectdesc` → e.g. `Pioneers Group Photo 1890` (also mirrored in `<meta name="Description">`).
- `#objectdate`, `#objectstartyearrange`, `#objectendyearrange`, `#objectcredit` → **often EMPTY** (blank on 000844).

Image (in `#objectimages`):
- **Master (best representation)**: `<a class="image_anchor" href="./images/000844_..-lr.jpg">` — the full-res JPG. Resolve relative to the page URL.
- **Thumbnail (NEVER a master)**: `<img class="image" src="./images/tn_000844_..-lr.jpg">` — `tn_` prefix.
- Template UI graphics `images/img0001.gif`..`img0009.gif`, `little_logo.jpg` are NOT item images — ignore.
- **HTML-only item**: 000855 has no `image_anchor`/thumb → no downloadable master (edge case: catalog it, mirror nothing).

## Prose fields (LLM structured-extraction + grounding — FR-007/008)
Because `#objectdate` is often blank, the **rights-critical date is prose-embedded** in the description (e.g. "Pioneers Group Photo **1890**"). Extract via the engine, ground the excerpt on the page (the date value must appear in the evidence excerpt), and the operator confirms its interpretation at rights-assessment. Same for creator/credit when only present in prose.
