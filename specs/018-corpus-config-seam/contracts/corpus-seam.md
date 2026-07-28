# Contract: Corpus Config Seam

The new seam. Everything else reuses shipped modules unchanged. Revised after the spec review.

## Manifest + browser-profile loaders

```
loadCorpusManifest(corporaRoot, id): CorpusManifest   // reads <corporaRoot>/<id>.yml
                                                      // typed; throws on unsupported schemaVersion / malformed / basename != id
loadBrowserProfile(corporaRoot, id): BrowserProfile        // reads <corporaRoot>/<id>.browser.yml
                                                           // typed; throws on malformed AND on absence
tryLoadBrowserProfile(corporaRoot, id): BrowserProfile|null // null ONLY when absent; a malformed
                                                           // profile that EXISTS still throws (FR-005)
listCorpusManifests(corporaRoot): CorpusManifest[]    // enumerates ALL committed manifests under the root (FR-015)
```
`corporaRoot` is an **injected parameter** (FR-016), resolved once at the composition root — `<repoRoot>/corpora` in production, `tests/fixtures/corpora` under test. Manifest and profile share one convention under it. No core module may hardcode it; **SC-003 depends on this**.

## Selection (composition root)

```
selectCorpus({ corporaRoot, cliCorpus?, envCorpus? }): SelectedCorpus
   // corporaRoot REQUIRED, no default (FR-016); returns { corporaRoot, manifest }
```
- Precedence `cliCorpus` (`--corpus`) → `envCorpus` (`COLONY_CORPUS`) → **throw** (no default). Unknown id → throw.
- Called ONCE at the CLI / browser-build composition root; result derives the narrow policies. No core function re-inspects env or a case operand.
- **Corpus-dependent** commands require a selection; **exceptions** (`bib validate-config`, help/version, non-corpus repository diagnostics) do not. A missing `BrowserProfile` fails only browser-default-consuming commands.

## Narrow policy derivation (immutable)

```
deriveScopeContext(corpus): ScopeResolutionContext      // { validCaseIds: ReadonlySet }
deriveSourceIdPolicy(corpus): SourceIdPolicy            // { prefix, padWidth } — SINGULAR:
                                                        // the corpus's one allocatable policy (FR-002b)
deriveArchiveLayoutPolicy(corpus): ArchiveLayoutPolicy  // generic + ReadonlyMap overrides
deriveBrowserProfile(corpus, envOverride?): BrowserProfile
```
Each hotspot receives ONLY its policy; never the manifest, never a registry.

## Config validator (strict)

```
validateCorpora(corporaRoot, sourcesDir, installedCapabilities): Result
   // enumerates every committed manifest + profile under corporaRoot (FR-015)
   // and reads existing Sources from sourcesDir for existing-data validation
```
Fail loud, specific message per failure — per-manifest, repository-wide, existing-data, browser-profile/override references, and (at selection) capability subset. **Every committed manifest must validate before any corpus runs.** Surfaced as `bib validate-config` (full) + startup validation (selected corpus + global identity index).

## Archive-layout resolution order (FR-017)

```
sourceLayout(sourceId):
  1. policy.overrides.get(sourceId)      // manifest archiveLayoutOverrides (validated, has a reason)
  2. runtimeLayoutOverlay.get(sourceId)  // registerSourceLayout — members created mid-run; UNCHANGED
  3. policy.derived.get(sourceId)        // PRECOMPUTED generic derivation (see constraint)
  4. throw                                // no default (Principle V)
```

**Constraint that forces precomputation**: `sourceLayout(sourceId)` is sourceId-only and synchronous (reached deep inside the fetcher via `resolveFetchedDir`), while `deriveSourceLayout(source, fallbackCase)` needs a full `Source`. `policy.derived` is therefore built when the policy is constructed at the composition root, where the corpus's Sources are already loaded — never derived lazily inside `sourceLayout`.

**Retained unchanged**: `registerSourceLayout` (including its fail-loud conflict detection), `isSourceLayoutRegistered`, `deriveSourceLayout` — `member-layout.ts` (`ensureMemberLayoutRegistered`) and the acquire pipeline call them. Only the static `SOURCE_LAYOUTS` map is retired.

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
- **INV-12**: Existing-data validation catches a Source whose ID conforms to **none** of its Corpus's policies, and a next-allocated ID that would collide (FR-002a/002b). `PB-S001`/`PB-S002` conform via the corpus's second policy and MUST validate.
- **INV-15**: A manifest with zero `sourceIds` policies, or with a count of `allocatable: true` other than exactly one, fails validation; prefix disjointness is checked across ALL policies of ALL corpora, not one per corpus (FR-002b).
- **INV-13**: No core module hardcodes the corpora root — pointing `corporaRoot` at a fixture directory selects and operates a corpus there with zero `src/` edits (FR-016, SC-003).
- **INV-14**: Layout resolution follows the total order overrides → runtime overlay → precomputed derivation → throw; `registerSourceLayout` still throws on a conflicting re-registration, and `ensureMemberLayoutRegistered` resolves a mid-run member exactly as before (FR-017, SC-001).
