# La Nouvelle France Hand-Check List

Use this checklist for manual browser review of `PB-P001`.

## Gallica core

### `https://gallica.bnf.fr/ark:/12148/cb328261098/date`

- Confirm the title shown on the serial page.
- Confirm the run label: `7 années disponibles - 78 numéros`.
- Record year counts for `1879` through `1885`.
- Check whether `Informations détaillées` gives publication-place, title-history, or run notes.
- Check whether any export, permalink, or citation tools expose cleaner serial metadata.

### `https://gallica.bnf.fr/ark:/12148/cb328261098/date1879`

- Record all issue dates shown for 1879.
- Confirm whether there are exactly `6` issues.
- Note whether the year page is stable or intermittently blocked.
- Check whether clicking issue dates produces stable issue URLs.

### `https://gallica.bnf.fr/ark:/12148/cb328261098/date1880`

- Record all issue dates shown for 1880.
- Confirm whether there are exactly `8` issues.
- Note any missing expected months or irregular cadence.

### `https://gallica.bnf.fr/ark:/12148/cb328261098/date1881`

- Record all issue dates shown for 1881.
- Confirm whether there are exactly `8` issues.
- Check whether `1881-08-15` appears exactly as expected.

## Verified Gallica issue pages

- `https://gallica.bnf.fr/ark:/12148/bpt6k5603637g`
- `https://gallica.bnf.fr/ark:/12148/bpt6k5606843t`
- `https://gallica.bnf.fr/ark:/12148/bpt6k56068447`
- `https://gallica.bnf.fr/ark:/12148/bpt6k56068462`
- `https://gallica.bnf.fr/ark:/12148/bpt6k5606847g`
- `https://gallica.bnf.fr/ark:/12148/bpt6k5606848w`
- `https://gallica.bnf.fr/ark:/12148/bpt6k56068536`

For each one:

- Confirm the displayed issue date.
- Confirm rights status, especially whether it says `domaine public`.
- Record any issue number shown.
- Check whether download buttons are present and what formats they allow.
- Note whether the page belongs clearly to the same serial run.

## Gallica search and result pages

### `https://gallica.bnf.fr/services/engine/search/sru?operation=searchRetrieve&version=1.2&query=%28gallica%20all%20%22La%20Nouvelle%20France%20journal%20de%20la%20colonie%20libre%20de%20Port-Breton%22%29&lang=fr&suggest=0`

- Confirm the top result is the serial `La Nouvelle France (Marseille)`.
- Check whether the result count is still extremely broad or noisy.
- Check whether filtering to `Presse et revues` changes anything useful.

### `https://gallica.bnf.fr/services/engine/search/sru?operation=searchRetrieve&version=1.2&collapsing=disabled&query=%28gallica%20all%20%22La%20Nouvelle%20France%20journal%20de%20la%20colonie%20libre%20de%20Port-Breton%22%29%20and%20arkPress%20all%20%22cb328261098_date%22&rk=21459;2`

- Confirm whether this reliably shows only issues from the target serial.
- Check whether it exposes issue dates more cleanly than the year pages.
- Record whether it still triggers security verification.

## SLQ core

### `https://www.slq.qld.gov.au/blog/la-nouvelle-france-nineteenth-century-propaganda`

- Confirm the wording about `two bound volumes`.
- Record exactly which issue numbers are visible in the post.
- Confirm the blog's stated date span for the SLQ holding.
- Check for any explicit reuse or download language on-page.

### `https://onesearch.slq.qld.gov.au/permalink/61SLQ_INST/tqqf2h/alma99183978086302061`

- Confirm the title record.
- Confirm the date span shown there.
- Confirm call number `RBS 919.5 004`.
- Check whether the record exposes issue-level structure or only title-level metadata.
- Check whether rights or download terms are item-specific.

### `https://digital.slq.qld.gov.au/delivery/DeliveryManagerServlet?dps_func=stream&dps_pid=FL3270958`

- Confirm what actually loads.
- Check whether it is a single image, page image, or entrypoint into a larger object.
- Check whether the UI around it reveals a volume, page, or issue identifier.
- Check whether there are visible download or reuse terms.

## Comparator

### `https://natlib.govt.nz/records/21623106`

- Confirm the specimen issue note.
- Confirm the statement about `No. 1` beginning in July 1879.
- Check whether it says anything about total run length.

## Most important questions

- Does Gallica really support a `1879-1885` run for this title?
- Is SLQ describing only its own holding subset rather than the full publication run?
- Can exact issue dates for `1879`, `1880`, and `1881` be captured from Gallica by hand?
- Do Gallica issue pages consistently show `domaine public`?
- Do SLQ pages expose item-specific reuse terms, or only general host guidance?
