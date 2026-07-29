# Audit triage — end-govern run 2026-07-28T23-57-30-196Z-gsxe

34 HIGH findings, 30 chunks, 1 round, 2-model fleet (claude + codex), zero degraded lanes.
Every finding was adversarially re-verified against the shipped code by four independent
read-only passes. Verdicts below are the re-verification's, not the audit's.

**Fleet-agreement signal held.** Only 6 of 34 had cross-model agreement; 26 were single-lane.
The single-lane set carried nearly all the over-calls. Per the execute skill's
fleet-degradation-pricing driver, a single-lane HIGH is weaker evidence than an agreed one,
and that is what the data showed.

## Confirmed defects (10)

Ordered by blast radius. Several were reproduced empirically, not argued.

| ID | Defect | Evidence |
|---|---|---|
| 04 | Next-ID prediction reads declared `sourceId`s while the allocator reads **filenames**. A file whose basename differs from its declared id passes validation, then the allocator mints a colliding id and writes it. | Reproduced: `PB-P002.yml` declaring `PB-P003` → validate clean → allocator mints `PB-P003`, bytes land, `duplicate-source-id` fires only afterwards. |
| 05 | Override collision detection compares override-against-override only. An override aimed at another Source's **generic** location is undetected, contradicting the header's own clause (d). Malformed override shapes also pass, then throw at resolve time. | Reproduced with a correctly-shaped path: 0 findings. |
| 29 | `loadCorpusManifest(corporaRoot, '../outside')` reads **outside the injected root** and `selectCorpus` accepts it, so `--corpus ../outside` yields real policies from an out-of-root file that `validate-config` never sees. | Reproduced, incl. nested `sub/deep`. |
| 32 | A **missing** `archiveLayoutOverrides` entry no longer throws — it derives a plausible-but-wrong slug, and `issueDir` (write path) has no existence guard, so masters mkdir into a parallel directory. Orphan assets (Principle XV). | Reproduced by stripping overrides: `PB-P002` resolves to a slug ≠ where its masters live. Minimality guard covers only the 9 hardcoded legacy ids. |
| 33 | `installArchiveLayoutPolicy` clears the memoized policy but never `runtimeLayoutOverlay`, so a stale overlay entry from corpus A outranks corpus B's derivation (overlay is step 2, derivation step 3). | Reproduced: after installing B, `SYN0001` still returns A's slug; even an empty policy leaves it registered. |
| 12 | `stripComments` desyncs on **regex literals** (fixed template literals, not regexes), so the constant-regression guards run blind. | 27 ground-truth mismatches across 7 files; a ~200-line span of `regenerate.ts` fed to the guard as live code. Guards green while blind. |
| 22 | `translate.ts` builds `sourcesDir` from `process.cwd()` while every sibling resolves cwd-independently. | Running `translate` from any directory but the repo root reads a non-existent dir. Reachable today. |
| 31 | `realResolve` collapses `..` **lexically** (`path.resolve`) before `realpathSync`, so a `../` escape through a symlink passes the deliberately non-bypassable archive write guard. | Reproduced with a real temp symlink: guard passed, bytes landed outside the root. **No production caller reaches it today** — defense-in-depth failure, not a live escape. |
| 30 | Two sourceIds can derive structurally-equal layouts (80-char slug truncation); nothing checks layout uniqueness, only sourceId re-claim. | Latent: 0 collisions in the current 91-source SSOT, but the longest derived slug is **79** chars against an 80 cap. |
| — | `verify-member` / `promote` pass the ambient-union-loaded list into `buildExistingMembers`, which **iterates** it to build the duplicate-detection set feeding a hard pass/fail check. The one genuine **scope** use of the ambient policy. | Every other ambient consumer is an id-keyed `find` or a `partOf` filter, where a superset predicate cannot misroute. |

## Refuted (8)

03, 08, 09, 11, 17, 19, 26, 28 — all reasoning-from-description errors.

- **03** `loadAllSources` *filters*, it does not validate; no new throw channel.
- **08** the coverage page's two loads share Source scope; no A-vs-B split exists.
- **09/11/19** `committedSourceFilenamePolicy()` is not a constant — it unions every installed manifest and throws loud on an absent root; consumers do id-keyed lookups a superset cannot misroute.
- **17** the `registerSource` calls are inside the imported module itself; survives tree-shaking (verified against the real esbuild bundle).
- **26** resolution precedence is stated backwards relative to the code, and a named test asserts the true order.
- **28** the fixture root asserted missing exists, with the asserted contents.

## Shape / doc only (16)

01, 02, 06, 07, 10, 13, 14, 15, 16, 18, 20, 21, 23, 24, 25, 27, 34.

Recurring pattern: **the audit assumed "silent" where the code fails loud.** 07, 10, 13, 14
each rest on a quiet-wrong-answer claim that an existing guard turns into a named throw
(`resolveScopeRef`, `loadSourceFile` on a missing record, `source-id-nonconforming`).

The ambient-policy family (02/16/27) is **half-wired in shape, not in behavior**: measured,
`committedSourceFilenamePolicy()` and `deriveSourceFilenamePolicy(port-breton)` are
byte-identical on the shipped single-corpus config. FR-018 explicitly authorizes the ambient
call at the sites it names. What survives: the CLI wrappers sit *above* the boundary FR-018's
exception covers, and SC-003 is unproven for these verbs.

**Correcting an earlier controller claim:** I told the operator the deferred-composition
deviation was "a code-smell, not a correctness bug", then over-corrected to "it re-closes the
seam". Neither was right. It produces **zero wrong answers on the shipped configuration**; its
real costs are the one scope use above, and that a *fixtures-only* second corpus is invisible
to the ambient path — which is precisely SC-003's headline claim, so it matters for the proof
even though it breaks nothing today.

## The 15 "cross-chunk seam breaks" are chunking artifacts

All six `removed-export` claims are false — every symbol still resolves from
`@/archive/location` (moved and re-exported). The nine `changed-arity` ones are intentional
(FR-018 mandates the required parameter) and tsc proves every call site updated.

## Fix grouping

1. **Identifier → path without a convention check**: 04 + 29
2. **Validator honesty** (stated invariant wider than the code checks): 05 + 06
3. **Archive-layout invariants** (no uniqueness / existence / lifetime binding): 30 + 32 + 33
4. **Guard blindness**: 12
5. **cwd independence**: 22
6. **Ambient-policy threading + the verify-member scope use**: 02/16/27
7. **Path-guard hardening**: 31
