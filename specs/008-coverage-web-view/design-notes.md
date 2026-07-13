# Coverage view — frontend-design output (T004)

The concrete design the implementation tasks (T005–T011) build to. Produced through
`/frontend-design:frontend-design`. Visual reference (self-contained, real tokens + representative
data): `docs/superpowers/specs/2026-07-12-coverage-web-view-mockup.html`.

## Direction

The `/coverage` page is the archive's standing account of **its own holes** — an audit sheet in
the existing "Prospectus/Dossier" identity. **Reuse the shipped tokens; introduce no new palette
or typefaces** (they live in `site/src/layouts/BaseLayout.astro`): `--paper --ink --vellum --slate
--oxide --rule --faint`; voices `--didone` (titles/campaign names), `--serif` (cited work titles),
`--grote` (prose/abstract), `--mono` (all data, ids, matrices, the provenance rail).

**Signature — "the stamped gap."** Oxide (`--oxide`, the archive's critical-marks-only hand) is
spent exclusively on *missing evidence*: the literal `unknown`, a nonzero `gap` value, the
`unclassified` class, a `suspected gap` tag, the `No campaign` bucket heading, and the leading tick
on an open question. Everything held/known stays in `--ink`/`--slate`/`--faint`. Scanning the page,
the red marks are precisely where evidence is absent. Keep everything else quiet — this is the one
bold place. **No coverage percentage, ratio, or progress bar anywhere** (non-negotiable).

**Oxide rules (exact):**
- The literal `unknown` token → oxide (a `.unknown` span). Surrounding label words (e.g. "believed
  extent") stay `--slate`; stamp only the word `unknown`.
- `gap` value → oxide when it is `unknown` OR a number `> 0`; a `gap` of `0` is fully held → render
  `--ink` (not a gap).
- `unclassified` row label, `suspected gap` tag, `No campaign` heading, open-question `›` tick → oxide.

## Page shell

Wrap in `BaseLayout`; `<main class="coverage">` centered `max-width: 940px; padding: 56px 28px
96px` (matches the landing). Header: `<Masthead tail="research status" />` (see nav change below),
then a Didone `h1` thesis — **"What we hold, and what we're still missing."** — the oxide hairline
stamp (`132×2px`), a `--grote` abstract ending "…every gap is a count, or the word `unknown`", and a
small `--mono` legend line: *Marks in oxide are the gaps…*. **No hero number** (a big stat is the
template answer and a percentage is forbidden).

Each of the four sections: a `--mono` uppercase label (11px, 0.18em, `--faint`, bottom `--rule`)
with a right-aligned count (e.g. "1 campaign", "11 works", "4 open", "3 searches"), then content.

## Components (each ≤300–500 lines, scoped `<style>`, no client JS)

### `CampaignCoverage.astro` (T005) — `perCampaign: CampaignCoverage[]`
Per campaign, a card echoing `.entry` (white bg, `1px --rule` border, subtle shadow). Head: campaign
name in `--didone` + right-aligned campaign id in `--mono --faint` (linked per T010 rules, else
plain). Then the **extent rail** (mono, top `--rule` border — the provenance-rail echo):
`<actualMemberCount> held · <knownMemberCount> believed · gap <gap>` — with the `unknown`/`gap` oxide
rules above; when `knownMemberCount === 'unknown'` render "believed extent unknown" (only `unknown`
oxide) and gap `unknown`. Then `membersByLifecycleState` as a mono chip row (`count` in `--ink`,
state label in `--faint`). **Empty members** → "No members catalogued yet." (`--faint`, italic).

### `EvidenceDistribution.astro` (T006) — `evidenceClassDistribution`
A two-column mono grid (`class` left `--slate`, `count` right `--ink`, dotted `--rule` row rules),
`unclassified` label in oxide. **Counts only, never a percentage.** Empty → "No evidence classified
yet." (unlikely, but explicit).

### `ReferenceRegister.astro` (T007) — `register.byCampaign` + `register.ungrouped`
For each `byCampaign` group a mono uppercase group heading (campaign name · id); then the
`ungrouped` entries under a `No campaign` heading in oxide. Each entry: a two-column row — left a
mono tag (`reference` → "Cited · unidentified" `--faint`; `suspected` → "Suspected gap" oxide);
right the `citedAs`/`description` in `--serif` `--ink`, `basis` in `--grote --slate`, and `owner`
in `--mono --faint` (linked per T010 rules, else plain). **Empty register** → "Nothing unresolved
in the register." (`--faint`, italic).

### `SearchHistory.astro` (T008) — `searchHistory.matrix` + `byRepository`
A mono table: columns Repository (`--ink`), Campaign, Last searched (ISO date), Open questions
(each on its own line with a leading oxide `›`; when none, "— none open" `--faint`). Below, a
`--mono --faint` by-repository rollup line (`repository last <date>` · …). **No searches** → "No
searches logged yet." (`--faint`, italic).

## Page composition — `pages/coverage/index.astro` (T009)
Build-time frontmatter calls `loadCoverageReport()` (from `@/bibliography/coverage/load-coverage-report`)
and passes each slice to the four components in order (campaigns, evidence, register, search).
Fail-loud: if the helper throws, the build fails (no try/catch, no placeholder). A `--mono --faint`
colophon footer: "Coverage · derived from the bibliography at build · never a score, only counts and
unknown". `title="Coverage — what we hold, and what we're still missing"`.

## Masthead nav change — `Masthead.astro` (T011)
Make the masthead a baseline flex row and append ONE right-aligned nav link "Coverage" → `/coverage`
(mono, uppercase, the same hairline-underline-ignites-to-oxide affordance as the home wordmark).
This link is global (renders on every page → the one global-nav entry, FR-010). On `/coverage` mark
it `aria-current="page"` and drop the active underline (mirror the home wordmark's current state).
Do not disturb the existing `Corpus · <tail>` behavior. Keep the change minimal and API-compatible
(existing callers pass only `tail`/`current`/`gap`).

## Quality floor
Responsive to mobile (the 940px column already collapses; the search table must scroll inside an
`overflow-x:auto` wrapper on narrow screens); visible keyboard focus (inherited `:focus-visible`
oxide outline); reduced-motion respected (inherited); semantic headings; links only where a target
exists (T010). Every gap remains a count or the literal `unknown` — verify nothing renders a `%`.
