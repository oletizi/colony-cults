# Contract: Corpus Config Seam

The new seam. Everything else reuses shipped modules unchanged. Revised after the spec review.

## Manifest + browser-profile loaders

```
loadCorpusManifest(path): CorpusManifest      // typed; throws on unsupported schemaVersion / malformed / basename != id
loadBrowserProfile(path): BrowserProfile       // typed; throws on malformed / unknown corpus
```

## Selection (composition root)

```
selectCorpus({ cliCorpus?, envCorpus? }): SelectedCorpus
```
- Precedence `cliCorpus` (`--corpus`) → `envCorpus` (`COLONY_CORPUS`) → **throw** (no default). Unknown id → throw.
- Called ONCE at the CLI / browser-build composition root; result derives the narrow policies. No core function re-inspects env or a case operand.
- **Corpus-dependent** commands require a selection; **exceptions** (`bib validate-config`, help/version, non-corpus repository diagnostics) do not. A missing `BrowserProfile` fails only browser-default-consuming commands.

## Narrow policy derivation (immutable)

```
deriveScopeContext(corpus): ScopeResolutionContext      // { validCaseIds: ReadonlySet }
deriveSourceIdPolicy(corpus): SourceIdPolicy            // { prefix, padWidth }
deriveArchiveLayoutPolicy(corpus): ArchiveLayoutPolicy  // generic + ReadonlyMap overrides
deriveBrowserProfile(corpus, envOverride?): BrowserProfile
```
Each hotspot receives ONLY its policy; never the manifest, never a registry.

## Config validator (strict)

```
validateCorpora(allCommittedManifests, allProfiles, installedCapabilities, existingSources): Result
```
Fail loud, specific message per failure — per-manifest, repository-wide, existing-data, browser-profile/override references, and (at selection) capability subset. **Every committed manifest must validate before any corpus runs.** Surfaced as `bib validate-config` (full) + startup validation (selected corpus + global identity index).

## Characterization gate (SOURCE_LAYOUTS retirement)

```
before = <snapshot of current location.ts outputs for the 9 legacy Sources>   // committed fixture
after  = deriveArchiveLayoutPolicy(port-breton).resolve(source)
assert byte-identical(before, after)   // else a validated per-Source override (with reason) supplies it
```

## Coverage snapshot comparison (SC-001)

Compare a **structured** snapshot, not rendered prose: Source/group counts, statuses, unresolved leads, extent reporting, repository holdings, ordering, generated identifiers/links. Normalize only an added selected-corpus label, if introduced.

## Assertable invariants (test targets)

- **INV-1**: No selected corpus → `selectCorpus` throws; no partial run (SC-002).
- **INV-2**: Unknown/invalid/colliding config → throws at the load boundary (SC-002/005).
- **INV-3**: `--corpus` overrides `COLONY_CORPUS`; exception commands run with no selection (US1.3/1.5).
- **INV-4**: All 9 legacy archive paths byte-identical (generic or validated override) (SC-001).
- **INV-5**: A synthetic second corpus added as **fixtures only** is selectable + operable with zero core `src/` edits (SC-003, US3).
- **INV-6**: The four constants are absent from core modules; each seam reads an injected policy (SC-004).
- **INV-7**: The validator flags a **prefix that equals or is a leading substring of** another; a duplicate case id; a `padWidth` outside `1..8` (SC-005, FR-002a).
- **INV-8**: No spec-2 field appears in the spec-1 types (FR-012).
- **INV-9**: A selected corpus whose `requiredCapabilities` are not all installed fails startup validation (FR-008).
- **INV-10**: An archive override referencing an unknown Source (or a path escaping the archive root, or missing a reason) fails validation (FR-007).
- **INV-11**: A browser profile referencing an unknown corpus, or a duplicate profile id, fails validation (FR-005/008).
- **INV-12**: Existing-data validation catches a Source whose ID does not conform to its Corpus's policy (unless grandfathered) and a next-allocated ID that would collide (FR-002a).
