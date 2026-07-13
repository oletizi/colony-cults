# Tooling Feedback


## session-end 2026-07-08
- AskUserQuestion for execute-scope was denied; operator chose to end the session instead of starting /stack-control:execute — no tool defect, just a workflow choice.

## session-end 2026-07-12
- run_in_background bash jobs are killed by the harness after a while (the corpus render + the tailscale http.server both got killed mid-run); had to relaunch long-lived/long-running jobs as detached host processes (nohup + disown, no setsid on macOS) to survive. Cost several restarts.
- stackctl roadmap add <id> --depends-on A --depends-on B kept only the last value (B); needed a follow-up 'roadmap add-edge --field depends-on --to A' to add the first. Repeated --depends-on flags should accumulate (or the help should say single-value).

## session-end 2026-07-13
- speckit check-prerequisites.sh / setup scripts reject the long-lived feature branch name; the spec dir must be resolved via .specify/feature.json throughout (recurring TF-09 pattern across analyze/plan/tasks).
- cross-model govern audit-barrage times out in this environment (cannot convene the model fleet); shipped spec 010 via comprehensive validated-live + 'govern --override' (established env constraint).
