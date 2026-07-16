# Tooling Feedback


## session-end 2026-07-08
- AskUserQuestion for execute-scope was denied; operator chose to end the session instead of starting /stack-control:execute — no tool defect, just a workflow choice.

## session-end 2026-07-12
- run_in_background bash jobs are killed by the harness after a while (the corpus render + the tailscale http.server both got killed mid-run); had to relaunch long-lived/long-running jobs as detached host processes (nohup + disown, no setsid on macOS) to survive. Cost several restarts.
- stackctl roadmap add <id> --depends-on A --depends-on B kept only the last value (B); needed a follow-up 'roadmap add-edge --field depends-on --to A' to add the first. Repeated --depends-on flags should accumulate (or the help should say single-value).

## session-end 2026-07-13
- speckit check-prerequisites.sh / setup scripts reject the long-lived feature branch name; the spec dir must be resolved via .specify/feature.json throughout (recurring TF-09 pattern across analyze/plan/tasks).
- cross-model govern audit-barrage times out in this environment (cannot convene the model fleet); shipped spec 010 via comprehensive validated-live + 'govern --override' (established env constraint).

## session-end 2026-07-14
- bib acquire foreground fetch of a periodical/monograph (polite, rate-limited) exceeds the 8-min Bash tool timeout (SIGTERM); long real fetches must run detached (nohup+disown).
- bib acquire --dry-run reports would-fetch-N-pages even when masters are already in B2 (it estimates the full fetch, does not check object-store presence); this misled the initial read that PB-P007-P011 were unacquired. bib reconcile is the reliable already-acquired check.
- SSOT/archive drift: PB-P002 sat at status to-collect while its masters were acquired in B2, found only by auditing the archive provenance against the SSOT. Consider a bib audit verb that flags to-collect-but-acquired staleness corpus-wide.
- bib-coverage-cli integration test hard-codes live-corpus counts (PB-P004 actualMemberCount); any real corpus edit breaks it, and the PR CI gate is only the Netlify deploy-preview (no unit-test gate), so a broken assertion can merge until the next local run catches it.

## session-end 2026-07-15
- stackctl backlog done requires BOTH --reason <text> and --apply; surfaced via two failed attempts (first missing --reason, then a dry-run without --apply). Minor CLI-ergonomics friction — a single clear usage error listing both required affordances would save the round-trips.

## session-end 2026-07-15
- bib inventory --repository <url> --dry-run only prints the identifier + sourceUrl, not the resolved rights-critical date / grounded rights evidence -- so to assess acquirability (valid master + groundable pre-1955 date) before creating a member I had to drive adapter.resolve directly in a throwaway script. The dry-run should surface the proposed rights evidence (the same fields rights-assess review-mode shows) so an operator can judge acquire-worthiness without a scratch script.
- NewItalyMuseumAdapter acquire's mediaFor() throws 'unrecognized master image extension' when the source page's image_anchor href is truncated/incomplete (e.g. newitaly.org.au item 000845 href './images/000845_', no filename) -- the real fault is a broken source image link, not an unknown media type. A clearer 'broken/incomplete source image href' error would make the residual (SOURCE image broken, not our bug) legible at a glance.

## session-end 2026-07-16
- tsx -e with @/ imports silently no-ops (dynamic import('@/...') from an eval entry never resolves its .then/.catch, process exits 0) — my early 'bib validate/regenerate exit 0' runs were hollow false-greens. Use a real .ts script file with absolute-path imports (ROOT/src/...), not npx tsx -e, to drive project code.

## session-end 2026-07-16
- bib validate/regenerate require COLONY_ARCHIVE_ROOT even for pure-SSOT edits (search-log entry, suspected-lead resolution, notes text) that touch no provenance-bearing assets — the provenance cross-check is bundled into validate, so a clean model-only validation of SSOT-only changes isn't reachable without the archive clone. A --no-provenance / model-only validate mode would let bookkeeping passes verify without the clone.
