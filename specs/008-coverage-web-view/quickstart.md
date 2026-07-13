# Quickstart: Coverage (Gap Audit) Web View

Runnable validation that the `/coverage` page renders the coverage report correctly and
fails loud on bad data. Assumes the corpus-browser site and the corpus-coverage-audit
projection are present (this feature's dependencies).

## Prerequisites

- Repo checked out on `feature/coverage-web-view`; `npm ci` done.
- Committed bibliography present (`bibliography/sources/*.yml`, `bibliography/search-log.yml`).
- No archive, snapshot, or network access is required.

## 1. Helper unit test

```bash
npx vitest run tests/unit/bibliography/load-coverage-report.test.ts
```

**Expected**: `loadCoverageReport()` returns a well-formed `CoverageReport` from the committed
bibliography (includes the `PB-P004` campaign); it fails loud on a malformed source fixture and
does not throw when the search log is absent (see `contracts/load-coverage-report.md`).

## 2. Build the site and open the page

```bash
npm run site:build          # builds site/dist, including /coverage
npm run site:preview        # or the project's preview command
```

Open `/coverage`. **Expected** (see `contracts/coverage-view.md`):

- **Per-campaign coverage** lists `PB-P004` with members-by-lifecycle-state counts and its
  believed extent as *N held of M believed (gap G)* — or *believed extent unknown*.
- **Evidence-class distribution** lists each class as a count, including `unclassified`.
- **Unresolved-references register** groups entries by campaign with an explicit "no campaign"
  bucket; each entry is marked reference vs suspected with its basis and owner.
- **Search history** shows the repository × campaign matrix (last searched, open questions) and
  the by-repository rollup.

## 3. Verify the invariants

- **No percentage**: search the rendered `/coverage` HTML — it contains no coverage percentage,
  ratio badge, or progress indicator; gaps read as counts or the literal `unknown`.
- **Cross-links**: every identifier that has a `/sources/<id>` page links to it; every
  source-group id (e.g. `PB-P004`) renders unlinked. No dangling links.
- **One nav link**: exactly one masthead link leads to `/coverage`.

## 4. Fail-loud check

Temporarily introduce a malformed bibliography entry (e.g. break a required field in a
`bibliography/sources/*.yml`), then:

```bash
npm run site:build
```

**Expected**: the build **fails** with an error naming the offending item; `/coverage` is not
emitted with a partial report. Revert the change afterward.

## 5. Empty-state check (optional)

With an environment/fixture where the search log is empty, confirm the search-history section
renders "no searches logged yet" rather than a blank section or an error.
