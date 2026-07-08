# La Nouvelle France

## Source ID

`PB-P001`

## Citation

*La Nouvelle France : journal de la colonie libre de Port-Breton, Océanie*. Marseille: Typographie Blanc et Bernard, publication span disputed in current host records.

## Source type

Primary / newspaper / propaganda periodical.

## Access

- Archive or vendor: State Library of Queensland; Bibliotheque nationale de France (Gallica)
- URL or catalog record: https://www.slq.qld.gov.au/blog/la-nouvelle-france-nineteenth-century-propaganda ; https://onesearch.slq.qld.gov.au/permalink/61SLQ_INST/tqqf2h/alma99183978086302061 ; https://gallica.bnf.fr/ark:/12148/bpt6k5603637g
- Date accessed: 2026-07-07
- Rights/copyright status: likely public domain by publication date; mirrorability of the currently available digital copies remains unverified
- Local copy stored? no

## Summary

Promotional newspaper for the Port Breton scheme. It presented the proposed colony as prosperous and desirable and appears to have been used directly in recruitment.

Two concrete digital access paths are now confirmed:

- State Library of Queensland says it holds two bound volumes of issues published between 1879 and 1881 and that those volumes have been digitised and can be viewed online.
- Gallica provides issue-level access, with at least the 15 July 1879 issue confirmed.
- Gallica metadata for the verified issue identifies it as a press fascicle, shelfmark `JO-3094`, source `Bibliotheque nationale de France`, and rights status `domaine public`.

Current minimum coverage picture:

- SLQ blog evidence explicitly shows `Volume 1` material from issues `1-10`.
- The same SLQ post also shows `Volume 2` examples from issues `13`, `20`, and `21`.
- Search-visible Gallica issue pages confirm at least `1879-07-15`, `1879-11-15`, `1879-12-15`, `1880-02-15`, `1880-03-15`, `1880-04-15`, and `1881-08-15`.
- An external catalogue record at the National Library of New Zealand notes an introductory `No. specimen` dated `15 June 1879` and `No. 1` starting in July 1879.
- Live browser access to Gallica's serial run page reports `7 années disponibles - 78 numéros` with the following year counts:
  - `1879`: 6 issues
  - `1880`: 8 issues
  - `1881`: 8 issues
  - `1882`: 12 issues
  - `1883`: 21 issues
  - `1884`: 13 issues
  - `1885`: 10 issues

Verified Gallica issue endpoints now captured:

- `1879-07-15`: `ark:/12148/bpt6k5603637g`
- `1879-11-15`: `ark:/12148/bpt6k5606843t`
- `1879-12-15`: `ark:/12148/bpt6k56068447`
- `1880-02-15`: `ark:/12148/bpt6k56068462`
- `1880-03-15`: `ark:/12148/bpt6k5606847g`
- `1880-04-15`: `ark:/12148/bpt6k5606848w`
- `1881-08-15`: `ark:/12148/bpt6k56068536`

Verified SLQ title-level identifiers now captured:

- One Search permalink: `https://onesearch.slq.qld.gov.au/permalink/61SLQ_INST/tqqf2h/alma99183978086302061`
- Library system ID: `slq_alma99183978086302061`
- Call number: `RBS 919.5 004`
- Data-export date span: `1879- 1881?`
- Public delivery URL exposed in Queensland open data: `https://digital.slq.qld.gov.au/delivery/DeliveryManagerServlet?dps_func=stream&dps_pid=FL3270958`
- Delivery response observed from that URL: inline JPEG with filename `18397808630-v001-0007.jpg`

Verified Gallica serial-level identifier now captured:

- Serial run page: `https://gallica.bnf.fr/ark:/12148/cb328261098/date`

Relevant rights guidance now captured:

- State Library of Queensland says all text on its website is under `CC BY 4.0`, but other website material may be used for private study, research, criticism, and review, and commercial use requires permission from the copyright holder.
- State Library of Queensland also says many digitised collections are out of copyright and may be printed, copied, or downloaded without permission, but this should still be confirmed against the specific record before mirroring.
- Gallica's verified issue metadata labels the issue itself as `domaine public`, which is the clearest mirrorability signal found so far for a host copy.

## People mentioned

- Marquis de Rays
- Paul de Groote

## Places mentioned

- Port Breton
- New Ireland
- Oceania
- Marseille

## Ships mentioned

- Unknown from the digitized issues reviewed so far.

## Events mentioned

- Recruitment campaign for the Free Colony of Port Breton.

## Notable claims

- The paper was used as a propaganda and recruitment vehicle for the colony.
- State Library of Queensland describes its holding as two bound volumes covering 1879-1881.
- Verified issue-date evidence shows Gallica access reaching at least August 1881.
- Verified issue-date evidence now includes a clustered sequence from `1879-11-15` through `1880-04-15`, except that `1880-01-15` has not yet been verified.
- Gallica's live serial page reports a much longer available run, extending through `1885`.

## Quotations

No direct issue quotations recorded yet.

## Reliability notes

This is a core primary source for recruitment claims, but it is also a promotional organ of the scheme and should be treated as interested advocacy rather than neutral description.

The current uncertainty is not whether the nineteenth-century newspaper itself is public domain, but whether the digital reproductions currently available from host institutions may be mirrored in the private archive without further rights review.

This note distinguishes between the underlying nineteenth-century publication and host-specific statements about the digitized files. The strongest current signal favors Gallica for lawful preservation review, while SLQ still needs record-level confirmation before any mirror decision based on its copy.

Coverage is no longer only a minimum verified span: Gallica's live serial page exposes year-level counts through 1885. What remains incomplete is the exact issue-by-issue census inside those yearly buckets.

There is now an explicit source conflict about run length:

- Earlier working assumptions and some host cues suggested `1879-1881` or `1879-1882`.
- Gallica's live serial page says `La Nouvelle France (Marseille) 1879-1885` with 78 issues across 7 years.

That discrepancy should be preserved rather than flattened.

## Exhausted avenues in this pass

- Search-engine discovery produced stable Gallica issue hits for selected dates, but not a full run listing.
- Direct Gallica search and SRU endpoints triggered anti-bot verification, preventing a clean extraction of the full `issue by date` sequence from the live site.
- SLQ's JavaScript-heavy catalogue did not yield readable full-record metadata directly through terminal fetches, but the media page and Queensland open-data export exposed stable title-record identifiers and a direct delivery URL.
- A browser-automation pass was considered, but the expected local Playwright wrapper referenced by the skill was not present in this environment.
- After the repo-local Playwright path was restored, browser navigation reached the Gallica serial run page and exposed year-level counts, but direct year-page navigation remained intermittent and could still fall back to `403 Access Interdit` on repeated requests.

At this point, the remaining unknowns are not due to untried simple discovery routes. They are mainly blocked by host-side interface and bot protections.

## Cross-references

- `bibliography/sources.csv`
- `bibliography/acquisition-tracker.csv`
- GitHub issue `#1`
- GitHub issue `#2`
- `PB-P002`
- `PB-P003`
