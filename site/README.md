# Corpus Browser (`site/`)

A static [Astro](https://astro.build) site that browses the historical corpus — each page shown as a **facsimile beside its parallel text** (raw French OCR + English translation, with per-page corrected French), inside the "Prospectus/Dossier" archival frame. v1 content is **PB-P001** (*La Nouvelle France*, 73 collected issues); the data layer generalises to other periodical sources.

Spec: [`specs/005-corpus-browser/`](../specs/005-corpus-browser/). The headless corpus/data layer lives in [`src/browser/`](../src/browser/) (root package, `@/browser/*`); this `site/` project renders it.

## Prerequisites

- Node 20, repo deps installed (`npm install` at the repo root).
- To build from the archive OR to regenerate the snapshot: a local **archive clone** with the corpus (default on this machine: `/Users/orion/work/colony-cults-archive`). To build from the committed snapshot (e.g. on Netlify): **no archive needed**. The corpus content is **public-domain** — no credentials are required either way.

## Configuration (environment, no secrets)

| Var | Required | Meaning |
|-----|----------|---------|
| `CORPUS_ARCHIVE_PATH` | no | Path to the local archive clone. When set and present, the build reads it fresh; when unset, the build reads the committed snapshot (below). |
| `CORPUS_SNAPSHOT_DIR` | no (default `site/data`) | Where the committed snapshot lives (one `<sourceId>.json` per source). Absolute, or relative to the repo root. |
| `CORPUS_SOURCES` | no (default `PB-P001`) | Comma-separated source ids to include. |
| `CORPUS_IMAGE_PROVIDER` | no (default `source-iiif`) | `source-iiif` (Gallica IIIF) or `b2-cdn` (object-store + CDN). |
| `CORPUS_CDN_BASE` | only for `b2-cdn` | CDN base fronting the B2 bucket. Fail-loud if the provider is `b2-cdn` and this is unset. |

`loadCorpus` picks the corpus source by explicit precedence (no silent fallback): **archive** if `CORPUS_ARCHIVE_PATH` is set and exists, **else** the committed snapshot if present, **else** it throws naming both. Image URLs are always (re-)resolved from the stored handles by the active provider, so the same snapshot serves either `source-iiif` or `b2-cdn`.

## Build & preview

```bash
# from the repo root
CORPUS_ARCHIVE_PATH=/path/to/colony-cults-archive npm run site:build   # astro build + Pagefind index
npm run site:preview -- --host 0.0.0.0                                  # serve site/dist (add --host to expose)
```

`site:build` runs `astro build --root site && pagefind --site site/dist`. Output is the static `site/dist/` (git-ignored). `site:preview` serves it — no application server, no env var needed at serve time.

With `CORPUS_ARCHIVE_PATH` unset, the same `npm run site:build` builds entirely from the committed snapshot (no archive) — this is what the public/Netlify deploy runs.

## Publishable snapshot (build without the archive)

The build needs only **public-domain text + metadata** — page images are resolved to Gallica/CDN URLs and fetched client-side, never bundled. So the corpus is exported to a committed snapshot the build reads instead of the private archive:

- `site/data/<sourceId>.json.gz` — the serializable corpus for one source (text, provenance, and image **handles**: `folioId`, `ark`, `objectStoreKey`), deterministic (sorted) key order, **gzipped** (~5.5 MB vs ~17 MB raw). Public-domain, so it is **committed** to the repo (not git-ignored). Folios are enumerated from the archive's `fNNN.yml` sidecars (not the `.jpg` binaries — the archive keeps only metadata; images live in B2/Gallica).

### Reproducible regeneration (mechanically pinned)

The snapshot is **not** a hand-run step against an arbitrary clone — it is a deterministic build target keyed to a pinned archive commit:

- **`site/data/archive-source.json`** pins the archive repo + the exact commit the committed snapshot was generated from.
- **`npm run snapshot`** regenerates `site/data/*.json` from that pin: it sets up a *clean, sparse (text-only), detached* archive worktree at the pinned ref and runs the generator against it. Same pin → byte-identical snapshot. (Needs archive access + a local archive clone; `ARCHIVE_REPO` / `ARCHIVE_WORKTREE` override the defaults.)
- **`npm run snapshot:check`** regenerates into a temp dir and diffs against the committed data, failing on any drift — the reproducibility proof and staleness guard (run it in CI given archive access).

To refresh the corpus: bump the `ref` in `site/data/archive-source.json`, run `npm run snapshot`, verify `npm run snapshot:check`, and commit the changed data. A build with no `CORPUS_ARCHIVE_PATH` reads these files; image URLs are re-resolved at build time by the active provider, so swapping `CORPUS_IMAGE_PROVIDER` needs no archive. This closes **OQ-3 / OQ-4** for the public deploy: the build's access to corpus data is the committed public-domain snapshot — no credentials, no archive access, no build-time secrets.

## Image-source provider

The reading-view viewer (OpenSeadragon) is provider-agnostic; the provider is chosen by `CORPUS_IMAGE_PROVIDER`:

- **`source-iiif`** (default) — tiled IIIF deep-zoom from Gallica (`https://gallica.bnf.fr/iiif/<ark>/<folio>`).
- **`b2-cdn`** — a full image from the archive object-store key fronted by `CORPUS_CDN_BASE` (`<cdnBase>/<object_store key>`). A real deploy additionally needs the CDN/B2 bucket to send CORS headers (the viewer sets `crossOriginPolicy: 'Anonymous'`).

A missing provider config fails the build loud — there is no silent fallback.

## Search

Client-side, no server: [Pagefind](https://pagefind.app) indexes the built reading-view HTML (both French and English) at build time. The landing-page "Concordance" searches every page and links each result to its reading view.

## Deploy (static, no archive)

Any static host (Netlify / Cloudflare Pages) builds from the committed snapshot with **no archive clone**. The repo ships [`netlify.toml`](../netlify.toml): build command `npm ci && npm run site:build`, publish `site/dist`, and `CORPUS_IMAGE_PROVIDER = "source-iiif"`. Netlify has no `CORPUS_ARCHIVE_PATH`, so the build reads `site/data/*.json`. If you enforce a Content-Security-Policy, the site is self-contained (embedded display font as a `data:` URI, same-origin search bundle) — the only external request is to the **image host** (`gallica.bnf.fr` for `source-iiif`, or your CDN for `b2-cdn`), which you allow-list in `img-src`.

### Public export

Publishing is a **deliberate** action, distinct from the internal build (the corpus being public-domain, this is an editorial-readiness gate, not a rights filter):

```bash
npm run site:export-public              # refuses — explains it is a deliberate decision
CORPUS_ARCHIVE_PATH=/path npm run site:export-public -- --confirm   # produces site/public-export/
```

(What gets curated/published is [OQ-4](../specs/005-corpus-browser/spec.md), deferred — the script implements only the confirmation seam.)

## Tests

The headless data layer is covered by `vitest`:

```bash
CORPUS_ARCHIVE_PATH=/path/to/colony-cults-archive npm run browser:test
```

Unit tests (OCR page-split, translation pairing, image providers, search docs) run without the archive; the integration tests (`tests/integration/browser/`) need `CORPUS_ARCHIVE_PATH` and exercise the real PB-P001 issue plus fail-loud/corrupted-copy cases.

## Conventions

TypeScript (`@/` imports), no fallbacks/mock data outside tests (the loader throws, naming source/issue/page, on missing/inconsistent data), no `any`/`as`/`@ts-ignore`, files ≤ 300–500 lines. All UX/UI work goes through the `frontend-design` skill (project commandment).
