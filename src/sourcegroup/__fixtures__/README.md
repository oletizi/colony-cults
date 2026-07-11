# Source-Group Fixtures

This directory contains test fixtures for the source-group acquisition pipeline.

## The PB- namespace requirement

`@/bibliography/load`'s `SOURCE_ID_PATTERN` / `SOURCE_FILE_PATTERN`
(`^PB-[A-Z]?\d{3}$`) require EVERY `Source` -- group or member -- to carry a
`PB-`-prefixed id, and the id must match the file's stem exactly
(`loadSourceFile` rule 1). This is a repo-wide, corpus-wide flat-namespace
convention (see `@/model/source`'s doc comment and the spec's Key Entities
section), not something special-cased to `PB-P004`. Any fixture placed in
this directory that is meant to be loadable via `loadSourceFile` /
`loadAllSources` MUST conform to that pattern, and its filename stem must
equal its `sourceId`.

## Files

### PB-P004.yml
Copy of the real Marquis de Rays legal-corpus source-group from `bibliography/sources/PB-P004.yml`. Used to test the pipeline against the shipped source-group.

### PB-S901.yml
Synthetic test fixture with sourceId `PB-S901`. A made-up, PB-namespace-conforming source-group used to test pipeline reusability and ensure the implementation is not special-cased to PB-P004 -- a second, wholly distinct group (different case/language/creator) that loads through the same shipped loader as any real source-group.

## Usage

These fixtures are test-only data and live under `__fixtures__/` per the codebase mock-data constraint (fixtures satisfy the "no mock data outside tests" rule).

Use these in unit and integration tests to verify the source-group acquisition pipeline processes multiple distinct source-groups correctly.
