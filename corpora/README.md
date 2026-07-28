# Corpora

This directory holds **corpus manifests** and **browser profiles** — the data
that tells the apparatus which datasets exist, how their source IDs are
namespaced, and how they map onto the archive and the browser build. There is
no code here; adding a corpus means adding files under this directory (plus
case data under `bibliography/sources/`), not editing anything in `src/`.

This document assumes no prior context. If you just need to add or change a
corpus, read sections 1-4 and 8.

## 1. What a corpus manifest is

A corpus manifest is `corpora/<id>.yml`. The filename's basename (without
`.yml`) **must equal** the manifest's own `id` field — the loader rejects a
mismatch.

The real, committed example is `corpora/port-breton.yml`:

```yaml
schemaVersion: 1
id: port-breton
cases: [port-breton]
sourceIds:
  - { prefix: PB-P, padWidth: 3, allocatable: true }    # 92 primary sources, machine-allocated (src/sourcegroup/id-alloc.ts)
  - { prefix: PB-S, padWidth: 3, allocatable: false }   # PB-S001/PB-S002, hand-authored secondary works
requiredCapabilities:
  repositories: [gallica, new-italy-museum, internet-archive, papers-past]
  sourceQueries: [papers-past, papers-past-article]
archiveLayoutOverrides:
  PB-P002:
    relativePath: archive/cases/port-breton/books/nouvelle-france-colonie-libre-port-breton
    reason: >-
      Legacy hand-authored slug. ...
  PB-P003:
    relativePath: archive/cases/port-breton/books/baudouin-aventure-port-breton-1883
    reason: >-
      Legacy hand-authored slug. ...
```

Field by field:

| Field | Meaning |
|---|---|
| `schemaVersion` | Must be `1`. The loader rejects any other value outright — there is no upgrade/migration path yet. |
| `id` | The corpus's identity. Must equal the filename's basename. Selected via `--corpus <id>` / `COLONY_CORPUS=<id>`. |
| `cases` | Non-empty list of case ids this corpus owns. Grammar `^[a-z][a-z0-9-]*$`. A case id may appear in only one manifest repository-wide. |
| `sourceIds` | Non-empty list of `{ prefix, padWidth, allocatable }` ID-namespace policies. See section 2. |
| `requiredCapabilities` | `{ repositories: string[], sourceQueries: string[] }` — **names** of installed repository adapters / source-query configs this corpus depends on. This is a dependency declaration, not ownership: the corpus never owns the registry, it just names what must be installed before it can run. Checked at corpus selection. |
| `archiveLayoutOverrides` | `{ <SourceId>: { relativePath, reason } }`, or `null` if none are needed. See section 5. |

## 2. `sourceIds` is a list, not a single policy

Each entry is `{ prefix, padWidth, allocatable }`:

- `prefix` — an uppercase, optionally hyphen-delimited string matching
  `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$`. Note there is **no trailing-delimiter
  requirement** — `PB-P` is a valid prefix on its own, which is exactly what
  Port Breton ships.
- `padWidth` — an integer `1..8`; the zero-padded width of the numeric
  suffix (`PB-P` + padWidth 3 → `PB-P007`).
- `allocatable` — whether new IDs are minted from this policy. **Exactly one**
  policy per corpus must have `allocatable: true`; the allocator
  (`src/sourcegroup/id-alloc.ts`) needs one unambiguous target to draw the
  next ID from.

`sourceIds` is a list because a single corpus can legitimately carry more
than one ID namespace. Port Breton is the real example: it has 92
machine-allocated `PB-P###` primary sources (newspapers, books — anything the
allocator mints an ID for) plus 2 hand-authored `PB-S###` secondary scholarly
works (`PB-S001`, `PB-S002`) that were never run through the allocator. Both
namespaces belong to the same corpus, so both policies live in the same
manifest — `PB-P` marked `allocatable: true`, `PB-S` marked `allocatable:
false`. A Source is valid if it conforms to **any** of its corpus's declared
policies; only the allocatable one is ever used to mint a *new* ID. There is
no separate "grandfathering" mechanism for `PB-S001`/`PB-S002` — they simply
validate against the corpus's second policy like any other Source would.

## 3. Prefix disjointness

Across **every** `sourceIds` policy of **every** manifest in this directory
(not just within one corpus), no prefix may **equal**, or be a **leading
substring of**, another prefix. This is what keeps Source IDs globally
unique without a central counter: if `PB-P` and `PB-PX` were both allowed,
`PB-PX001` would be ambiguous — is it an ID from the `PB-P` namespace with an
odd suffix, or a `PB-PX`-namespace ID? The rule forbids that ambiguity
outright.

Running `validate-config` against two manifests declaring `PB-P` and `PB-PX`
produces (real output, from the corresponding test fixtures):

```
bib validate-config: 2 finding(s):
  [prefix-not-disjoint] alpha:PB-P/beta:PB-PX: source-ID prefix "PB-P" (corpus "alpha") is a leading substring of prefix "PB-PX" (corpus "beta"); namespaces must be provably disjoint (FR-002a)
  [next-source-id-collision] beta: the next allocated Source ID for corpus "beta" is "PB-PX001", which falls inside corpus "alpha"'s namespace (prefix "PB-P")
```

By contrast, Port Breton's own two prefixes, `PB-P` and `PB-S`, are fine:
neither is a leading substring of the other (they diverge at the second
character), so they are provably disjoint even though they share the `PB-`
stem.

This check runs across ALL committed manifests, not per-corpus — adding a
second corpus with a colliding prefix breaks validation for the whole
repository, not just the new corpus.

## 4. The browser profile

Beside each manifest, under the same `corporaRoot`, a corpus may have a
browser profile: `corpora/<id>.browser.yml`. The committed example,
`corpora/port-breton.browser.yml`:

```yaml
schemaVersion: 1
id: port-breton
corpus: port-breton
defaultSources:
  - PB-P001
  - PB-P002
  - PB-P003
  - PB-P007
  ...
  - PB-P092
```

- `schemaVersion` — must be `1`.
- `id` — unique across all committed profiles.
- `corpus` — must reference a real, known corpus id.
- `defaultSources` — the list of Source IDs the browser build shows by
  default for this corpus.

`CORPUS_SOURCES` (an environment variable, comma-separated Source IDs)
overrides `defaultSources` outright when set — it is read at the browser
composition root, not inside the profile itself.

**A missing browser profile does not fail non-browser commands.** Only
browser-deploy / browser-default-consuming commands require one; every other
corpus-dependent command (`coverage`, `validate`, `acquire`, etc.) never
looks at it.

## 5. Archive-layout overrides

The archive location for most Sources is derived generically — the
generic rule slugifies the Source's canonical title into a path under
`archive/cases/<case>/...`. For most Sources that generic derivation
reproduces the exact path the archive already uses. For a handful of legacy
Sources, filed by hand before the generic rule existed, it doesn't — and
relocating the archive to match the generic rule would be a canonical data
migration, which is out of scope.

`archiveLayoutOverrides` exists for exactly that case: a per-Source override
that says "use this literal relative path instead of the generic
derivation," with a mandatory `reason` explaining why. Port Breton needs
exactly two, out of its 9 legacy archive locations:

- **`PB-P002`** — the generic rule slugifies the canonical title "Colonie
  libre de Port-Breton : Nouvelle France en Oceanie" to
  `colonie-libre-de-port-breton-nouvelle-france-en-oceanie`, but the masters
  already committed to the archive live at
  `nouvelle-france-colonie-libre-port-breton` (title elements reordered and
  abbreviated by hand when the source was first filed).
- **`PB-P003`** — the generic rule slugifies "L'aventure de Port-Breton et la
  colonie libre dite Nouvelle-France" to
  `l-aventure-de-port-breton-et-la-colonie-libre-dite-nouvelle-france`, but
  the committed path is the author-first short form
  `baudouin-aventure-port-breton-1883`.

The other 7 of the 9 legacy Sources reproduce byte-identically through the
generic rule and deliberately carry **no** override.

The validator enforces, per override entry: the Source ID exists and belongs
to a Case in that corpus; the path is relative and cannot escape the archive
root; two Sources cannot resolve to the same location; and every entry
carries a `reason`. Beyond that, a **guard test**
(`tests/unit/corpus/archive-override-minimality.test.ts`) mechanically
checks minimality in both directions against the characterization fixture:
an override present where the generic rule already reproduces the legacy
path is flagged as *unnecessary*, and a legacy path the generic rule does
*not* reproduce with no override is flagged as *missing*. Don't add an
override "just in case" — it will fail that guard unless the generic
derivation genuinely can't reproduce the path.

## 6. Selecting a corpus

Every corpus-dependent command (anything that reads/writes corpus data,
allocates an ID, resolves scope, computes an archive path, produces
coverage, or loads browser defaults) needs an explicitly selected corpus:

```
--corpus <id>          # wins if present
COLONY_CORPUS=<id>     # used if --corpus is absent
```

There is **no implicit default** — not even Port Breton. Running a
corpus-dependent command with neither set fails loud:

```
$ npx tsx src/index.ts coverage
bib coverage: selectCorpus: no corpus selected — pass --corpus <id>, or set the COLONY_CORPUS environment variable to <id>; there is no implicit default (see FR-003)
```

An unknown corpus id also fails loud, naming the missing manifest file:

```
$ npx tsx src/index.ts coverage --corpus does-not-exist
bib coverage: selectCorpus: unknown corpus "does-not-exist" — no manifest at /path/to/corpora/does-not-exist.yml (loadCorpusManifest(...): cannot read file: ENOENT: ...)
```

A few commands are exceptions and run without a selected corpus:
`validate-config` (it validates every manifest, so selection would be
meaningless), and generic help/version.

The site build has no command line to pass `--corpus` on, so it relies on
`COLONY_CORPUS` alone. `netlify.toml` sets it explicitly:

```toml
COLONY_CORPUS = "port-breton"
```

## 7. Validation

Validation is **strict**: every manifest and browser profile committed under
`corpora/` must be valid before *any* corpus can run — a single malformed
manifest blocks the whole repository, not just itself. This is why a
draft/incomplete manifest belongs outside `corpora/` (e.g. under
`tests/fixtures/corpora/` while you're iterating) until it actually
validates.

Run the validator with:

```
npx tsx src/index.ts validate-config
```

(`src/index.ts` *is* the `bib` binary — there is no separate `bib` wrapper
script to invoke through.) A clean run over the real, committed manifests
looks like this (verbatim):

```
bib validate-config: corporaRoot=/Users/orion/work/colony-cults-work/corpus-config-seam/corpora
bib validate-config: sourcesDir=/Users/orion/work/colony-cults-work/corpus-config-seam/bibliography/sources
bib validate-config: checked 1 manifest(s) [port-breton] + 1 browser profile(s) [port-breton]
bib validate-config: clean -- no findings
```

It exits `0` on a clean run and `1` when it finds problems, printing every
finding it collects in one pass (not just the first).

**Two-tier split.** Validation runs at two different times with two
different scopes:

- **Startup validation** — runs automatically on every corpus-dependent
  command, immediately after corpus selection, before any command work
  begins. It checks that the **config is internally coherent**: every
  committed manifest/profile loads, corpus ids are unique, prefixes are
  disjoint, case ids are unique, browser profiles reference known corpora,
  and the selected corpus's `requiredCapabilities` are all installed. It
  deliberately does **not** read the bibliography SSOT (the actual Source
  files), so an unrelated data defect doesn't fail commands that never touch
  that data.
- **The full sweep** (`validate-config`) — everything startup validation
  checks, **plus** config-vs-data agreement: every existing Source ID is
  globally unique, every Source conforms to at least one of its corpus's ID
  policies, the next ID the allocator would mint doesn't collide with
  anything, and archive-layout overrides resolve against real Source
  records. This is the check to run in CI and after editing bibliography
  data, not just after editing a manifest.

## 8. Adding a new corpus

1. Pick an `id` (lowercase, used as the manifest's basename) and a
   Source-ID prefix that is provably disjoint (section 3) from every prefix
   already declared anywhere under `corpora/`.
2. While iterating, keep the manifest **outside** `corpora/` — e.g. under
   `tests/fixtures/corpora/<id>.yml` — since a committed-but-invalid
   manifest under `corpora/` blocks every other corpus.
3. Write the manifest: `schemaVersion: 1`, `id`, `cases` (at least one case
   id), `sourceIds` (at least one policy, exactly one `allocatable: true`),
   `requiredCapabilities` (naming installed repository/source-query
   capabilities the corpus actually uses — an empty list is fine if it uses
   none), and `archiveLayoutOverrides: null` unless you already know a
   legacy path the generic derivation can't reproduce.
4. Add case data under `bibliography/sources/` with filenames and Source IDs
   matching the manifest's `sourceIds` policies, each `case:` field matching
   one of the manifest's declared `cases`.
5. If the corpus needs browser defaults, write
   `corpora/<id>.browser.yml` beside the manifest (`schemaVersion`, `id`,
   `corpus`, `defaultSources`) — otherwise skip it; browser absence never
   fails non-browser commands.
6. Move the manifest (and profile) into `corpora/` once it's ready, then run
   `npx tsx src/index.ts validate-config` and fix any findings until it
   reports `clean -- no findings`.
7. Select it and confirm: `npx tsx src/index.ts coverage --corpus <id>`.
