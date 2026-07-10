# Phase 0 Research: Corpus Browser

All Technical-Context unknowns and technology choices resolved. The design record already fixed the major direction; this records the decisions, rationale, and rejected alternatives at plan grain.

## R-001 — Static site generator: Astro

- **Decision**: Generate the site statically with **Astro**, using its "islands" model for the two interactive surfaces (deep-zoom viewer, search).
- **Rationale**: The corpus is fundamentally static content (fixed page images + text). A build-time generator gives cheap, reproducible, host-anywhere output with no server, and Astro ships zero JS by default — only the viewer/search islands hydrate. Trivial to promote to a public deploy later. Matches the approved design.
- **Alternatives considered**: A dynamic app (server + DB) — rejected in the design: more capable for large-scale faceting/write features but needs hosting/infra and complicates the public-promotion + reproducibility story. Other SSGs (Next static export, Eleventy) — Astro's islands + first-class TS + minimal-JS default fit the "mostly static with two islands" shape best.

## R-002 — Deep-zoom viewer: OpenSeadragon

- **Decision**: Use **OpenSeadragon** as the page-image viewer island, configured with an **IIIF tile source** when the provider is `source-iiif`, and a **full-image** source when the provider is `b2-cdn` (OQ-6 working assumption).
- **Rationale**: OpenSeadragon is the standard deep-zoom viewer, supports IIIF tile sources natively (Gallica exposes IIIF), and degrades to a single full image with client-side zoom for non-tiled sources. Keeping the source authoritative and zoomable is a core requirement (noisy OCR ⇒ the scan must be inspectable).
- **Alternatives considered**: Leaflet-with-IIIF, custom `<img>` + CSS zoom — less capable for tiled deep-zoom; OpenSeadragon is purpose-built. IIIF-vs-full-image for `b2-cdn` (OQ-6) is deferred; v1 assumes full-image + client-side zoom, revisited if performance demands tiling/CDN.

## R-003 — Client-side search: Pagefind

- **Decision**: Index the built site with **Pagefind** at build time and mount its UI as the search island. Index **per page**, over **both French and English** text (OQ-5 resolved).
- **Rationale**: Pagefind is designed for static sites — it builds a chunked index from the emitted HTML and runs entirely client-side (no server), which matches the no-server constraint (FR-008) and the public-deploy story. Per-page granularity lets results link straight to the page reading view (FR-009).
- **Alternatives considered**: Lunr/FlexSearch with a hand-built index — more wiring and a hand-maintained document pipeline; Pagefind's build-from-HTML model is less code and stays consistent with what the reader sees. A server search index — rejected (no server).

## R-004 — Corpus normalization + fail-loud (the data layer)

- **Decision**: A headless `src/browser/` TS layer reads the **local archive clone** and normalizes to `Source → Issue → Page`. Per-page raw OCR is obtained by **splitting `issue.txt` on form-feed (`\f`)**; per-page corrected French + English come from `translation/pNNN.{fr,en}.txt`; provenance (id, ARK, date, rights, sha256, IIIF `original_url`) comes from the per-page `.yml` sidecar and the bibliography SSOT. Any missing/inconsistent layer (page count mismatch across images / OCR segments / translations; absent sidecar field) **throws**, naming source/issue/page.
- **Rationale**: Verified against the archive (`1879-08-15_bpt6k56068358`): 8 `fNNN.jpg`, `issue.txt` with 8 form-feeds, and `translation/pNNN.{fr,en}.txt` for p001–p008 each with a full provenance sidecar. Doing this in a headless, vitest-covered layer makes the fail-loud contract testable without a browser and reuses the repo's existing `@/model` + `@/bibliography` loaders/validators.
- **Alternatives considered**: Normalizing inside Astro page components — couples corpus logic to the renderer and makes fail-loud untestable in isolation; rejected. Trusting `issue.fr.txt`/`issue.en.txt` (issue-level) instead of the per-page `translation/` files — rejected: page-level data exists and the reading view is page-aligned (OQ-1 resolved).

## R-005 — Image-source provider abstraction

- **Decision**: One **`ImageSourceProvider` interface**, two implementations selected by config (dependency injection): `source-iiif` builds IIIF/image URLs from the source **ARK** (e.g. the sidecar's `original_url` / catalog ARK, Gallica IIIF); `b2-cdn` builds URLs from the archive **`object_store` key** + a configured **CDN base**. The viewer consumes an opaque image descriptor, so it is provider-agnostic (FR-012). Missing provider config (no CDN base; no ARK for a source) **throws** — no silent fallback to the other provider (FR-013).
- **Rationale**: The metadata already carries both handles (ARK in the sidecar/SSOT; `object_store` block from archive-object-store). A single interface keeps the reading view unchanged across providers and supports the public-vs-internal image story.
- **Alternatives considered**: Hard-coding Gallica IIIF — rejected: forecloses self-hosting images via B2/CDN. A runtime provider negotiation/fallback — rejected: violates the no-fallback rule; the operator picks one provider by flag.

## R-006 — UX/UI implementation is gated on `/frontend-design:frontend-design`

- **Decision**: This plan and its Phase-1 artifacts author **no UI**. Every user-facing surface — reading view (layout ①), source/issue navigation, search UI, the monospace provenance rail, and the "Prospectus/Dossier" visual system (warm serif source voice vs cool grotesque apparatus voice, oxide stamp-red on critical marks only, single archival theme, inlined display font) — is implemented in `/speckit-implement`, and each such task is **gated on invoking the frontend-design skill first** (Constitution Principle I; project commandment in CLAUDE.md).
- **Rationale**: Principle I is NON-NEGOTIABLE. The approved design record + reading-view mockup (produced under frontend-design + artifact-design) are the design reference the implementation elaborates; they are not a licence to off-road UI code.
- **Alternatives considered**: Implementing UI directly from the mockup HTML — rejected: violates the commandment. The mockup informs, it does not substitute for the skill.

## R-007 — Font embedding under strict CSP

- **Decision**: Inline the display typeface (the Didone/serif source voice and the grotesque/monospace apparatus voice as needed) as a **data-URI `@font-face`** in the site's CSS; ship no external font-host requests (FR-016). Prefer system/monospace stacks where a web font is not essential to the identity.
- **Rationale**: The public host applies a strict CSP that blocks font CDNs; a self-contained page is required. This mirrors the design record's explicit note and the artifact-CSP constraint.
- **Alternatives considered**: Google Fonts / CDN `@font-face` — rejected under CSP. Relying on system Didot — rejected: not portable across platforms; the identity needs a known face.

## R-008 — Deploy target & internal/public boundary

- **Decision**: Build output is a plain static bundle deployable to **Netlify or Cloudflare Pages**. The internal build reads the local archive clone; a **public deployment is a deliberate export** (OQ-4, deferred) — not wired into v1's internal build path. Because the corpus is public-domain, the boundary is an editorial/readiness decision, not a secrecy one.
- **Rationale**: Matches the design's public-reader/internal-first stance and the clarified public-domain reality (no credentials).
- **Alternatives considered**: Building straight to a public host from the archive — deferred (OQ-4); v1 keeps the export step explicit so the boundary stays intentional.

## Resolved unknowns

All Technical-Context fields are concrete (no `NEEDS CLARIFICATION` remain). Deferred spec open questions OQ-4/OQ-6/OQ-7 carry documented working assumptions (public export = later deliberate step; `b2-cdn` = full-image + client zoom initially; data layer = periodical shape) and do not block Phase 1.
