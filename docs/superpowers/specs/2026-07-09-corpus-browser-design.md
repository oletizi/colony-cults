# Design: Corpus Browser (`impl:feature/corpus-browser`)

- Date: 2026-07-09
- Roadmap item: `impl:feature/corpus-browser`
- Depends-on: `impl:feature/canonical-source-metadata` (shipped), `impl:feature/archive-object-store` (shipped), and `impl:feature/source-translation` (in-flight — translation output)
- Status: designing (awaiting operator approval) — **handed off for a fresh session**
- Backend: `superpowers:brainstorming`; visual direction via `frontend-design` + `artifact-design`.

## Problem domain

The corpus (page-image masters in B2, OCR `issue.txt`, corrected-French + English
translations, census, canonical source metadata) is not readable by a human without
a purpose-built surface. The goal: a website to **hold a source page, its French
words, and an English translation at once**, inside an archival frame that never
lets the propaganda pass for truth. v1 target: **PB-P001, *La Nouvelle France*** (78
issues, the richest data).

## Solution space

### Chosen — static Astro site; reading view = "Facsimile & parallel text"

- **Static, build-time generated (Astro).** A TS build step reads the corpus and
  normalizes it to a `Source → Issue → Page` model; Astro renders `source → issue →
  page` routes, with "islands" for the deep-zoom viewer and search. Cheap,
  reproducible, host anywhere, trivial to promote public later, no server.
- **Reading view — chosen layout ① of the mockup** (`2026-07-09-corpus-browser-reading-view-mockup.html`;
  published artifact: https://claude.ai/code/artifact/9ed3f795-d208-42d7-ad1f-df1f306242bd):
  the **deep-zoom page image leads** (left ~56%, OpenSeadragon), with the **French
  OCR and English translation stacked** on the right, page navigation within the
  issue. Keeps the authoritative scan prominent — important because our OCR is noisy
  ("Contraste insuffisant" is literally on the source).
- **Configurable image-source provider (operator's flag).** One interface, two
  backends: `source-iiif` (build IIIF/image URLs from the source ARK, e.g. Gallica)
  or `b2-cdn` (build URLs from the `object_store` key + a CDN base). Chosen by config;
  the viewer is agnostic. The metadata already carries both handles.
- **Client-side search (Pagefind)** over OCR + translation text, indexed at build.
- **Audience: public-reader, internal-first.** Build reads the private archive
  locally (OCR text, translations) + census/metadata (public) + image handles; a
  **public deploy is a deliberate export** of the public-domain text/images (decided
  later, not foreclosed). Deploy target Netlify/Cloudflare Pages.
- **Visual identity — "Prospectus / Dossier".** A swindle's glowing prospectus held
  in a cool archival dossier. Cool mat-board grey ground (#E4E3DD), iron-gall ink
  (#17150F), warm vellum source pane, cool slate apparatus, **oxide stamp-red
  (#9A3324) used only on critical marks** (OCR-condition note, rights stamp). The
  **source speaks in a warm Didone/serif voice; the apparatus + English translation
  in a cool grotesque/monospace voice** (encoding source-vs-critical-frame).
  Signature: the monospace **provenance rail** (source id / ARK / date / rights /
  page / sha256) — the archive's hand on the propaganda. Deliberately **single-theme**
  (an archival light-box). In the build, inline the display face as a data-URI
  (@font-face) rather than relying on system Didot (CSP blocks font CDNs).
- **Stack:** Astro + TS, OpenSeadragon, Pagefind; `@/` imports, no fallbacks
  (fail loud on missing/inconsistent corpus data), files ≤ 300–500 lines.

### Rejected — dynamic app (server + DB)

More capable for large-scale search/faceting + future write features, but needs
hosting/infra and complicates the public-promotion + reproducibility story. The
corpus is mostly static content; a static site fits.

### Rejected — reading-view layouts ② and ③

- **② Parallel edition** (bilingual facing columns hero; image a "plate") — best
  when line-for-line FR/EN reading is the primary activity, but demotes the scan,
  which our noisy OCR makes authoritative.
- **③ The exhibit** (image centered as object; FR/EN toggle side panel) — leans
  hardest into "held as evidence," but shows one language at a time and reads more
  like a gallery than a study surface. (Kept as a reference; its provenance-rail
  placement may inform ①.)

## Decisions

1. **Static Astro** site, build-time generated from the corpus.
2. Reading view **① Facsimile & parallel text** (image hero + stacked FR OCR / EN translation).
3. **Configurable image-source provider** (`source-iiif` | `b2-cdn`) via a flag.
4. **v1 scope: PB-P001**, with the data layer generalized so other sources slot in.
5. **Public-reader, internal-first**: build reads the private archive; public deploy is a deliberate PD export.
6. Client-side **Pagefind** search over OCR + translation text.
7. Visual identity: **Prospectus/Dossier** (above); single-theme; inline display font.
8. **Fail loud, no fallbacks** on missing/inconsistent corpus data.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Text↔image alignment**: per-page OCR is extractable (pdftotext form-feeds), but
  the English translation is currently **issue-level** — align to pages approximately,
  or present translation issue-level with per-page OCR? Depends on the
  `source-translation` output shape (coordinate with that feature).
- **Which text layers** to surface: raw OCR + corrected French + English, or a curated
  subset (e.g. corrected-French primary, raw OCR on demand).
- **Build access to private data**: how the generator reads the private archive
  (OCR/translations) + B2 image handles + config/creds; keep secrets out of git.
- **Public export pipeline**: what PD text/images get published, and how (a deliberate
  export step vs building straight from the archive).
- **Search granularity**: per-page vs per-issue index; French + English both.
- **Image path specifics**: IIIF tiling vs full-image + client-side zoom for the
  `b2-cdn` backend; CDN in front of B2.
- **Generalization**: monograph vs periodical vs source-group in the data layer
  (ties to `source-groups`).

## Provenance

- Origin: interactive brainstorming session, 2026-07-09.
- Decisions 1/3/4/5 from operator answers to `AskUserQuestion` prompts (purpose,
  architecture, image source, generator, scope); layout ② vs ③ vs **①** chosen by
  the operator from the published mockup artifact (URL above), built with real
  PB-P001 content under `frontend-design` + `artifact-design`.
- Consumes the shipped `canonical-source-metadata` (Source/Repository model) and
  `archive-object-store` (B2 image handles); consumes `source-translation` output.
- Handoff target: `/stack-control:define`.
