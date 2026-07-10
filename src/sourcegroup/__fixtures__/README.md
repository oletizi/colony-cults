# Source-Group Fixtures

This directory contains test fixtures for the source-group acquisition pipeline.

## Files

### PB-P004.yml
Copy of the real Marquis de Rays legal-corpus source-group from `bibliography/sources/PB-P004.yml`. Used to test the pipeline against the shipped source-group.

### TEST-GROUP.yml
Synthetic test fixture with sourceId `TG-001`. A made-up source-group used to test pipeline reusability and ensure the implementation is not special-cased to PB-P004.

## Usage

These fixtures are test-only data and live under `__fixtures__/` per the codebase mock-data constraint (fixtures satisfy the "no mock data outside tests" rule).

Use these in unit and integration tests to verify the source-group acquisition pipeline processes multiple distinct source-groups correctly.
