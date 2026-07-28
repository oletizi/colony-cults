# Contract: Corpus Config Seam

The new seam. Everything else reuses shipped modules unchanged.

## Manifest loader

```
loadCorpusManifest(path): CorpusManifest      // typed; throws on unsupported schemaVersion / malformed
```
- Discriminated on `schemaVersion`; fail loud on any unsupported version or shape.

## Selection (composition root)

```
selectCorpus({ cliCorpus?, envCorpus? }): SelectedCorpus
```
- Precedence: `cliCorpus` (`--corpus`) → `envCorpus` (`COLONY_CORPUS`) → **throw** (no default).
- Throws loud on an unknown corpus id (missing manifest).
- Called ONCE at the CLI / browser-build composition root; result derives the narrow policies (below). **No** core function re-inspects env or a case operand.

## Narrow policy derivation

```
deriveScopeContext(corpus): ScopeResolutionContext   // { validCaseIds }
deriveSourceIdPolicy(corpus): SourceIdPolicy          // { prefix, padWidth }
deriveArchiveLayoutPolicy(corpus): ArchiveLayoutPolicy
deriveBrowserProfile(corpus, envOverride?): BrowserProfile
```
- Each hotspot receives ONLY its policy; never the manifest, never a service locator.

## Config validator

```
validateCorpora(manifests): Result            // bib validate-config; also run at startup for the selected corpus
```
Checks (fail loud, specific message per failure): schema version; corpus-id validity + repo-wide uniqueness; ≥1 case; case-id uniqueness within + across manifests; source-ID prefix validity + repo-wide uniqueness + non-ambiguity; positive bounded pad width; selected corpus exists; referenced repositories ⊆ installed capabilities.

## Characterization gate (SOURCE_LAYOUTS retirement)

```
For each of the 9 legacy Sources:
  before = <current location.ts outputs>       // snapshot, committed as the gate fixture
  after  = deriveSourceLayout(source)           // generic
  assert byte-identical(before, after)          // or a validated per-Source override supplies it
```

## Assertable invariants (test targets)

- **INV-1**: No selected corpus → `selectCorpus` throws; no partial run (SC-002).
- **INV-2**: Unknown/invalid/colliding config → throws at the load boundary (SC-002/005).
- **INV-3**: CLI `--corpus` overrides `COLONY_CORPUS` (US1.3).
- **INV-4**: All 9 legacy archive paths are byte-identical through the generic layout (or a validated override) (SC-001).
- **INV-5**: A synthetic second corpus is selectable + operable with **zero** core `src/` module edits — diff is manifest/data/fixture only (SC-003, US3).
- **INV-6**: The four constants are absent from core modules; each seam reads an injected policy (SC-004).
- **INV-7**: The validator flags a duplicate source-ID prefix / case id across manifests (SC-005, global uniqueness).
- **INV-8**: No spec-2 field (`discoveryMechanism`/`dateNormalizer`) appears in the spec-1 types (FR-012).
