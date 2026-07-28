# Gallica Fixtures

Recorded test fixtures for unit and integration tests. All live fixtures fetched 2026-07-08 with User-Agent `colony-cults-research/0.1 (digital humanities; contact oletizi@mac.com)`.

## Live Fixtures

### issues-years.xml (299 bytes)
- Source: `GET https://gallica.bnf.fr/services/Issues?ark=ark:/12148/cb328261098/date`
- Purpose: Year list for a periodical (La Nouvelle France)
- Retrieved: 2026-07-08, HTTP 200

### issues-1879.xml (564 bytes)
- Source: `GET https://gallica.bnf.fr/services/Issues?ark=ark:/12148/cb328261098/date&date=1879`
- Purpose: Issue list for a specific year (1879)
- Retrieved: 2026-07-08, HTTP 200

### pagination-bpt6k5603637g.xml (2,154 bytes)
- Source: `GET https://gallica.bnf.fr/services/Pagination?ark=bpt6k5603637g`
- Purpose: Page count and image dimensions for an issue
- Retrieved: 2026-07-08, HTTP 200

### oairecord-bpt6k5603637g.xml (2,754 bytes)
- Source: `GET https://gallica.bnf.fr/services/OAIRecord?ark=bpt6k5603637g`
- Purpose: Dublin Core metadata including rights (public domain)
- Retrieved: 2026-07-08, HTTP 200
- Note: Contains `<dc:rights xml:lang="fre">domaine public</dc:rights>` and `<dc:rights xml:lang="eng">public domain</dc:rights>`

### iiif-page-sample.jpg (2,979 bytes)
- Source: `GET https://gallica.bnf.fr/iiif/ark:/12148/bpt6k5603637g/f1/full/,150/0/native.jpg`
- Purpose: IIIF image thumbnail (width-150, first page)
- Retrieved: 2026-07-08, HTTP 200

## Synthetic Fixtures

### oairecord-non-public-domain.xml (2,837 bytes)
- Purpose: Test fixture for rights-refusal scenarios (in-copyright)
- Created: 2026-07-08
- Note: Synthetic copy of `oairecord-bpt6k5603637g.xml` with `dc:rights` values changed from "domaine public"/"public domain" to "in copyright"

### archive/legacy-source-layouts.json
- Purpose: T001 (spec 018-corpus-config-seam) characterization gate -- a
  byte-identical snapshot of every `@/archive/location` function whose output
  depends on the static `SOURCE_LAYOUTS` map, for the 9 legacy Port Breton
  source ids (`PB-P001/002/003/054/055/056/057/058/059`). Captured BEFORE
  `SOURCE_LAYOUTS` was touched by T013 (which retires it for a generic
  derivation + validated overrides). Read by
  `tests/unit/archive/location-legacy-characterization.test.ts`; protects
  SC-001/INV-4.
- Created: 2026-07-27, generated from current (pre-T013) code, not fetched.
