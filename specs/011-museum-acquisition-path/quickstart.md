# Quickstart: validate the New Italy Museum acquisition path

Runnable validation scenarios proving the feature end-to-end. Prereqs: private per-session archive clone + S3/B2 env (see `009` quickstart / [[archive-acquisition-setup]]); `npm install`; the coding-agent engine (codex) available on PATH.

## 0. Gate — Gallica cutover has no regression (US2, SC-003)

```
npm test -- src/repository/gallica src/sourcegroup/acquire
```

Expected: `GallicaAdapter` characterization tests green — ARK inventory, public-domain verification, archive layout + provenance, object-store keys + checksums, source-group guardrails, and reconcile transitions identical to the pre-cutover baseline. A reference to the removed hardwired `ark → fetch` path fails to compile / throws (no back-compat path remains).

## 1. Model + coverage surfaces (US3, US4 — no acquisition needed)

```
npm test -- src/bibliography/load-coverage-fields src/bibliography/coverage
tsx src/index.ts coverage        # or the project's bib coverage entrypoint
```

Expected: PB-P006's two leads render with `resolution: identified` (not open bullets); PB-P006's extent renders as its explicit three-state value with basis (no bare `unknown`); authoring a bare `unknown` extent or an `excluded` lead without a reason fails loud.

## 2. Extraction grounding (SC-002)

```
npm test -- src/extraction
```

Expected (against fixtures, no network/engine): a fabricated field (excerpt not on page) throws; a date whose excerpt does not contain its value throws; identical inputs verify identically; engine-absent throws.

## 3. Acquire one identified museum item end-to-end (US1, SC-001)

```
bib inventory <musarch-item-url> --group PB-P006 --repository new-italy-museum
bib verify-member <newSourceId>
bib promote <newSourceId>
bib rights-assess <newSourceId>          # confirm public-domain against the shown evidence excerpt
bib acquire <newSourceId> --object-store  # long fetch -> run detached (nohup+disown) if needed
bib reconcile <newSourceId>
bib coverage
```

Expected: the master + full provenance (retrieval date, original URL, checksum, format, museum credit) are present in B2; the RepositoryRecord reconciles to `archived`; coverage counts the acquired work once. Re-running `bib acquire` is idempotent (no duplicate object). A candidate whose rights are not operator-confirmed `public-domain` is refused (SC-006).

## 4. Fail-loud spot checks (Principle V)

- `bib acquire` on a record with a non-`public-domain` recorded rights status → refused.
- Inventory a raw museum URL without `--repository` → fails loud (ambiguous selection; no sniffing).
- Remote asset changed since inventory → acquire throws or versions; never silently replaces a master.

## Success = measured

Every claim above is verified by inspecting the object store + reconcile/coverage output and the green test suite — never asserted. Record the measured deltas in `RESEARCH_LOG.md` (no temporal projections).
