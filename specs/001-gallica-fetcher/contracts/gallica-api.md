# Contract: Gallica endpoints the client depends on

Base: `https://gallica.bnf.fr`. All verified HTTP 200 on 2026-07-08 with the project User-Agent, except `.texteBrut` (403). The client (`src/gallica/`) is the only code that touches these; tests run against recorded fixtures in `tests/fixtures/`.

## Issues — census

`GET /services/Issues?ark=<periodicalArk>/date` → XML year list (`<issues listType="years" totalIssues="N">`).

`GET /services/Issues?ark=<periodicalArk>/date&date=YYYY` → XML issue list:

```xml
<issue ark="bpt6k5603637g" dayOfYear="196">15 juillet 1879</issue>
```

Client extracts `@ark` and the text date per issue.

## Pagination — page count

`GET /services/Pagination?ark=<issueArk>` → XML with `<nbVueImages>N</nbVueImages>` and per-page `<image_width>/<image_height>`. Client reads `nbVueImages`.

## OAIRecord — rights gate

`GET /services/OAIRecord?ark=<issueArk>` → Dublin Core XML containing:

```xml
<dc:rights xml:lang="fre">domaine public</dc:rights>
<dc:rights xml:lang="eng">public domain</dc:rights>
```

Client requires the public-domain value; stores the whole response as `rawResponse`. **Not** the IIIF `license` field.

## IIIF Image — page fetch

`GET /iiif/ark:/12148/<issueArk>/f<n>/info.json` → `{ width, height }`.

`GET /iiif/ark:/12148/<issueArk>/f<n>/full/full/0/native.jpg` → `image/jpeg`, full native resolution. `n` ranges `1..nbVueImages`.

## Blocked (do not use)

`GET /ark:/12148/<issueArk>.texteBrut` → **403**. The OCR-text endpoint is anti-bot protected; the tool self-OCRs instead.

## Client obligations

- User-Agent `colony-cults-research/<version> (digital humanities; contact oletizi@mac.com)`.
- Rate limit (~1 req/s, ≤2 concurrent) + exponential backoff on 429/403/5xx, then throw (never silent-skip).
- Parse via `fast-xml-parser`; treat malformed/empty payloads as errors (fail loud).
