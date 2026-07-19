---
slug: 015-papers-past-acquisition
targetVersion: ""
---

# Audit log — 015-papers-past-acquisition

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-01 — `decodeImageArea` splits on `/` to isolate the base64 segment, but standard base64 legitimately contains `/`

Finding-ID: AUDIT-20260719-01
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/repository/papers-past/parse.ts:36-49 (`decodeImageArea`)

`decodeImageArea` isolates the base64 payload with `const segment = imageUrl.split('/').pop();` (line 36), then `Buffer.from(segment, 'base64')` (line 40). The `'='` padding shown in the doc example (`...zNzA=`) and the choice of the standard `'base64'` decoder (not `'base64url'`) both indicate the source emits **standard** base64 — whose alphabet includes `/`. A standard-base64 string of the length shown (~60 chars) contains at least one `/` character the majority of the time (each char is `/` with probability 1/64; `1-(63/64)^60 ≈ 0.61`). Whenever the encoded segment contains a `/`, `split('/').pop()` returns only the tail after the last internal `/`, so `Buffer.from(...)` decodes a truncated/garbage byte string, `URLSearchParams` finds no `area`, and the function throws at line 45.

Blast radius: this is the ordering key for every article image — the feature's core acquired asset. It fails **loud**, so no silent corruption, but ~60% of real article pages would throw during parse, breaking acquisition. Critically, the shipped de Rays fixture's example base64 (`P29pZD1...zNzA=`) happens to contain no `/`, so the unit suite is green while production breaks — exactly the fixture-passes/production-fails trap an unattended agent would ship. A robust fix isolates the payload by the known marker rather than the ambiguous last `/`, e.g. `imageUrl.split('/imageserver/').pop()` (then strip any trailing `?…`/`#…`), which is correct regardless of `/` inside the base64. If the source is actually base64url, the decoder must be `'base64url'` and the `/`-split is still wrong — either way this line is defective.

---

### AUDIT-20260719-02 — Image locators remain relative, so live acquisition will fetch invalid URLs

Finding-ID: AUDIT-20260719-02
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/repository/papers-past/parse.ts:104-112

`extractImageLocators` returns the raw `src` attribute as `url` without resolving it against `sourceUrl`. Real Papers Past image tags in the committed fixture use root-relative paths such as `/imageserver/newspapers/...`, and this parser preserves that relative value at lines 104-112. The adapter’s byte-fetch contract expects a fetchable URL; with the shipped `HttpClient`, `fetch('/imageserver/...')` will fail before any image is mirrored.

The blast radius is high because a downstream operator running `bib acquire` on a normal Papers Past article will hit this on the central happy path: the page parse succeeds, then the image download fails because the locator is not absolute. A reasonable fix is to make `parseArticle` actually use `sourceUrl`, resolving each image `src` with `new URL(url, sourceUrl).toString()`, and add a fixture assertion that returned locators start with `https://paperspast.natlib.govt.nz/imageserver/`.

### AUDIT-20260719-03 — Governed-read test does not prove persist-before-parse

Finding-ID: AUDIT-20260719-03
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/repository/papers-past/adapter.test.ts:135-160

The test title and comments assert the T019 invariant that the raw article page is persisted “BEFORE parsing,” but the fixture is a successful parse path. A regression that calls `parseArticle(page.html, pageUrl)` first and persists only afterward would still pass every assertion here: navigation occurs, byte fetch is empty, and an `.html` capture exists after `resolve()` returns. The missing edge is the failure path: script HTML that is navigable but unparsable, expect `resolve()` to throw, then assert the raw capture still exists. Blast radius is high because this invariant is the source-frugality safety rail; if a real Papers Past page changes shape or parsing misses, an unattended acquisition run would discard the one fetched raw response and force another source hit.

### AUDIT-20260719-04 — Remote-change guard is blind to dropped/absent recorded segments; partial acquisition still returns `complete: true`

Finding-ID: AUDIT-20260719-04 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/repository/papers-past/adapter.ts (acquire PHASE A loop `for (const locator of parsed.imageLocators)` + remote-change block + `return { ... complete: true }`)

The remote-change fail-loud only fires along one direction: for each **freshly-parsed** locator it looks up a recorded same-sequence master and throws if the checksum diverges. It never iterates the *recorded* assets to detect a master that the record pins but the fresh parse no longer yields. So if a record pins page-masters for sequences `[1,2,3]` and the page now parses only `[1,2]` (a segment dropped, or the imageserver returns fewer facsimile tiles), PHASE A verifies `[1,2]`, PHASE B commits `[1,2]`, and the method returns `assets: [seg1, seg2]` with `complete: true, reconciliationRequired: true`. The pinned segment 3 silently vanishes from the acquisition with no fail-loud.

This defeats the feature's stated "remote-change fail-loud / never mirror a mismatched copy" invariant for the drop case: content-shift *within* an existing sequence is caught (its checksum changes), but a *missing* sequence is not. Blast radius: an unattended acquisition run over a public-domain historical newspaper page whose facsimile set shrank will archive a strictly-smaller copy and report it complete — silent partial data loss that downstream reconciliation treats as a finished, coherent mirror. A reasonable fix is a coverage assertion before returning: every recorded `role === 'page-master'` sequence must be present in `verified`, else throw the same remote-change error class.

---

### AUDIT-20260719-05 — Full URLs are accepted without enforcing the Papers Past origin

Finding-ID: AUDIT-20260719-05
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/repository/papers-past/adapter.ts:230-232, src/repository/papers-past/adapter.ts:395-401

`loadArticle` treats any trimmed value starting with `http` as the article page URL. That means a malformed or compromised `RepositoryRecord.sourceUrl` can point outside `https://paperspast.natlib.govt.nz/newspapers/...`; the adapter will still navigate, persist, parse, and later fetch image locators derived from that page as long as the page shape and article id match. The identity guard at lines 406-412 only checks the parsed article code against the record identifier; it does not prove the page or image URLs came from Papers Past.

Blast radius is high because this is an acquisition adapter: a downstream unattended run could mirror arbitrary same-shaped GIF content under a legitimate Papers Past identifier if the source URL is wrong. The fix should normalize through `new URL` and require the expected scheme, host, and `/newspapers/` path for full article URLs; parsed image locators should also be constrained to the expected Papers Past origin before byte fetch.

### AUDIT-20260719-06 — Scenario (a) fetches a live source URL with the raw `HttpClient`, off the governed `bib query-source` path

Finding-ID: AUDIT-20260719-06
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/repository/papers-past/acquire.test.ts:93-105 (`const client = new HttpClient(); const bytes = await client.getBytes(url);`)

Scenario (a) constructs `new HttpClient()` and calls `client.getBytes(url)` directly against `https://paperspast.natlib.govt.nz/imageserver/...` to perform an image-CDN reachability check. This is exactly the shape the project's non-negotiable commandment forbids: "Every query against an external online source MUST go through `/fetching-online-sources` … Never off-road with … the raw `HttpClient` … even for a 'quick public GET' … There is NO fallback and no second channel." A GIF-magic reachability probe is "checking whether a source holds something" / reconnaissance — squarely inside the governed surface (Principle XII). The test even documents its own off-path status in the failure string ("the documented fallback is fetching these bytes via the browser session … instead of a bare HttpClient GET"), confirming this is not the sanctioned client.

Blast radius: this file is presented as *the acceptance test for a Papers Past acquisition feature whose entire purpose is governed fetching*. An agent building unattended, or an operator cloning this test as a template, will read "a bare `HttpClient` GET against a source URL is sanctioned in this repo" and reproduce the forbidden pattern in production-adjacent code — the precise bug-factory the constitution exists to prevent. A reasonable fix routes the reachability probe through the same governed acquisition surface the adapter uses (or asserts reachability as a side effect of the scenario-(b) governed acquire), rather than a standalone raw-client GET.

---
