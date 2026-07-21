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

## session-end 2026-07-16
- Harness global CLAUDE.md instructs using the ~/.claude agent-memory store, which directly conflicts with Constitution Principle XIII (No Agent Memory, Ever). This session re-introduced agent memory (3 Gallica-access memories) before catching it mid-define while reading the constitution; had to migrate the durable facts into AGENTS.md and delete the store. Future sessions: honor Principle XIII over the global memory instruction from the start.

## session-end 2026-07-17
- B2-direct acquisition (museum spec 011, Internet Archive spec 013) mirrored masters to B2 + recorded them in the SSOT but never wrote the archive companion records the pipeline reads -- 42 archived records' masters (incl. the de Groote book) were undiscoverable by the translator, and NO gate caught it. There was no cross-repo SSOT<->companion reconciliation; the B2-direct path silently diverged from the Gallica companion convention. Fixed by building bib validate's undiscoverable-master/orphaned-companion/checksum-drift sanity check.
- govern --mode implement (whole-feature chunked audit-barrage) ran 40+ min across 8+ chunks and was killed; driving the adapter against the real archive.org item ('run the thing to see if it works') caught 7 real-data bugs (scandata field names, output-dir mkdir, native-DPI source, JBIG2->PNG lossless, stale-output collision, qualityAssessment persistence, loader/serializer threading) that fixtures matching the parser never could. Live verification outperformed governance for correctness here.

## session-end 2026-07-20
- audit-barrage did not converge on spec 015: finding count grew across 7 rounds (2->4->3->4->6->7) as each fix enlarged the diff re-audited (myopic convergence); required an operator override of the marginal residue. Process-drivers (029 US8) mitigate but did not prevent it on a mid-size feature.
- audit-barrage cross-chunk blindness produced 2 false-positive HIGH findings (AUDIT-20/21): a zero-folio guard and an allow-list key present in one chunk were reported missing because the dependent code sat in another chunk. Cost a verify cycle.
- default audit-barrage fleet includes a sonnet lane (claude --model claude-sonnet-4-6) that times out on whole-feature payloads and blocks convergence; had to drop to a 2-lane frontier fleet (claude/opus + codex/gpt-5.5), matching the plugin's own frontier-only self-hosting config. The shipped default should probably be frontier-only.
- long govern runs (~10 min) launched via Claude Code Bash run_in_background were repeatedly reaped by the environment before completing; had to launch detached via nohup/disown and poll the log. The --background/--status flags the execute skill documents are absent in stackctl 0.58.x.
- resolve-tiers rejects a task id with a letter suffix (T010a): task checkbox has no T-id. Had to renumber to T015. Minor.
## session-end 2026-07-17
- bib acquire --dry-run requires COLONY_S3_* env (resolveObjectStoreConfig) even though a dry-run never uploads to B2 — hit 'required environment variable COLONY_S3_BUCKET is not set' on the first dry-run; had to source .env for a no-upload examine step.
- IA acquire auto-cleans the staging dir on success, so post-hoc OCR verification of the mirrored master had no local input (silently produced 0 hits); had to download the master back from B2 to verify. A --keep-staging flag (or verifying against B2) would help.

## session-end 2026-07-17
- stackctl resolve-tiers rejects a task id with a letter suffix (e.g. T009a inserted between T009 and T010) as 'line NN: task checkbox has no T-id' — inserting a task mid-list after /speckit-analyze forces either a full renumber or folding the work into a sibling; supporting Txxx-suffix ids (or naming the offending id) would smooth the analyze-remediation seam.

## session-end 2026-07-19
- govern FATAL'd on a non-obvious two-file lockstep: removing the sonnet lane from .stack-control/fleet-knowledge.yaml alone is insufficient — it must exactly match the configured barrage lanes (audit-barrage-config.yaml / shipped template), and the mismatch only surfaces as a fatal at govern time, not at edit time. A pre-govern 'stackctl fleet-check' (or a single source of truth for lanes) would catch it early.

## session-end 2026-07-19
- stackctl govern (implement mode, whole-feature) FATALs during audit-barrage payload assembly when the diff includes a committed data file larger than the 24KB per-file fleet envelope — e.g. a ~49KB source-page capture under bibliography/repository-responses/ (every Papers Past acquire commits one). Govern's code-only scoping excludes .md docs but not large .html/.json data captures. It should exclude the corpus data paths (bibliography/repository-responses/, archive companions) from the CODE audit payload the way it excludes documentation. Workaround this session: operator-authorized govern --override (short-circuits the barrage cleanly). Captured locally as TASK-45; upstream stackctl defect worth a deskwork issue.

## session-end 2026-07-20
- govern --item scoped the audit payload to the whole long-lived-branch diff, pulling in a 455KB pre-existing data file (bibliography/repository-responses/PB-P055/*.json) that FATAL'd the run before any model lane ran; worked around with --diff-base <feature-base>. Related to backlog TASK-45 (govern-excludes-data-paths) but distinct: the FATAL is a hard stop, not a skip.
- govern FATALs when ANY single file in the committed diff exceeds the 24576-byte chunk envelope, TEST files included; at round 9 this forced a mid-convergence split of acquire.test.ts (25954B) and acquire.ts (33005B). It surfaces late (after 8 clean-ish rounds) rather than as an up-front size gate; a pre-flight size check or hunk-splitting a single large non-code/test file would avoid a wasted round.
- govern claude audit lane hit a transient API 500 (server-side) in round 5, degrading the fleet (produced 1/2) and correctly refusing to treat the quiet round as convergence; a plain re-run recovered. Degraded-fleet pricing (FR-007) worked as intended — noting only the transient API instability.

## session-end 2026-07-21
- Merging origin/main into the feature branch imported two merged-but-'planned' corpus-gap-closure roadmap items (source-query-client, papers-past-acquisition). The design compass then HARD-REFUSED (off-rail, exit 4) all new design work until both were advanced to shipped via 'workflow advance --apply'. Reconciling another workstream's forward-lifecycle status was an unexpected, blocking prerequisite to starting unrelated design in the merging session.
- The speckit before_specify hook (speckit.git.feature, optional:false) wants a per-spec feature branch, which conflicts with this repo's one-long-lived-branch model (specs 014-016 share feature branches). The define skill documents this (TF-09) but the mandatory hook still nominally fires; authoring proceeded by creating the spec dir directly on the shared branch. A clearer 'one-branch mode' would remove the tension.
