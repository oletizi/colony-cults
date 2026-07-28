# Quickstart: validate the Corpus Config Seam

Two proofs: Port Breton is unchanged, and a second corpus works without touching core code.

## Prerequisites

- The `port-breton` manifest exists (`corpora/port-breton.yml`, authored from the current constants).
- Baseline: capture current `location.ts` outputs for the 9 legacy Sources as the characterization fixture **before** retiring `SOURCE_LAYOUTS`.

## Proof 1 — Port Breton behavior-preserving (US2 / SC-001)

```
export COLONY_CORPUS=port-breton        # explicit composition (dev convenience), not a code fallback
npm test                                # full suite green, incl. the characterization test
npx tsx src/index.ts bib validate       # clean
npx tsx src/index.ts bib coverage       # semantically identical to pre-change
```
Expect: all existing Sources validate unchanged; the 9 legacy archive paths byte-identical; coverage identical; no data migration.

## Proof 2 — explicit selection fails loud (US1 / SC-002)

```
unset COLONY_CORPUS
npx tsx src/index.ts bib coverage        # FAILS LOUD — no selected corpus, no implicit default
npx tsx src/index.ts bib coverage --corpus does-not-exist   # FAILS LOUD — unknown corpus
npx tsx src/index.ts bib validate-config # validator over all manifests: pass/fail with specific messages
```

## Proof 3 — a second corpus, zero core edits (US3 / SC-003 — the load-bearing proof)

```
# Add ONLY (under tests/fixtures/, never corpora/ — see FR-015):
#   tests/fixtures/corpora/synthetic.yml           (different id, case, prefix, browser policy)
#   tests/fixtures/browser-profiles/synthetic.yml
#   tests/fixtures/cases/<second-case>/…           (a small fixture Source)
npx tsx src/index.ts bib coverage --corpus synthetic   # operates on the synthetic corpus
git diff --stat                                         # touches ONLY tests/fixtures/ — NO src/ core module
```
Expect: scope resolution, ID allocation, archive layout, and browser defaults all use the synthetic corpus's policies; a synthetic ID allocates with its prefix/pad and is globally unique. If any core `src/` module had to change, the constants were relocated, not removed — **fail the feature.**

The synthetic corpus lives under `tests/fixtures/`, **not** `corpora/`: under the strict policy (FR-015) every manifest committed to `corpora/` must validate before any corpus runs, so a test fixture placed there would bind synthetic case ids and source prefixes into the production disjointness namespace.

## Proof 4 — config validation catches collisions (US4 / SC-005)

```
# A second manifest reusing PB-P (or a Port Breton case id) → validate-config FAILS LOUD (repo-wide collision).
npx tsx src/index.ts bib validate-config
```

## Done when

SC-001…SC-005 hold: Port Breton unchanged; explicit-selection fail-loud; a synthetic second corpus selectable with zero core edits; no corpus-specific constant remains in core modules; the validator deterministically accepts/rejects.
