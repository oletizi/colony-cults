# Contract: corpus-browser view-model + loader additions (US2 / FR-008)

Data plumbing only. The rendered abstract UI (Astro under `site/`) is built **exclusively**
through `/frontend-design:frontend-design` (Constitution XI) — a hard precondition on the display
task, not startable here.

## Loader (`src/browser/load/summary.ts`)

Mirrors `src/browser/load/translation.ts` — honest-absence semantics (missing summary → `null`,
never fabricated).

```ts
export interface LoadedSummary {
  readonly concise: string;                 // from issue.summary.short.en.md
  readonly label: MachineAssistLabel;       // engine/model/retrieved from the concise sidecar
}
// Returns null when the concise summary artifact is absent (graceful no-summary state).
export function loadIssueSummary(issueDir: string): LoadedSummary | null;
```

Reads the sidecar with the `yaml` lib (as `translation.ts` does), surfacing engine/model/retrieved
via the existing `MachineAssistLabel` shape. Never throws on absence; throws only on a present-but-
corrupt artifact (fail loud).

## View-model additions (`src/browser/model.ts`)

- `IssueView.conciseSummary?: LoadedSummary` — the per-issue abstract.
- `SourceView.conciseSummary?: LoadedSummary` — the source rollup abstract (landing page).

Wired in `src/browser/load/corpus.ts` where `IssueView`/`SourceView` are assembled, additive and
optional so issues/sources without summaries render unchanged.

## Display contract (built via /frontend-design)

- The concise abstract is shown on the issue view and the source landing page, **visibly labeled a
  machine-generated summary** (interpretation, not evidence) — FR-006/SC-004.
- An issue/source without a summary renders without error and indicates no summary is available
  (US2 AC-3).
- Search index (`src/browser/search/documents.ts`): whether the concise abstract joins the index
  is a display-tier decision taken inside the `/frontend-design` task (out of scope for the loader
  contract).
