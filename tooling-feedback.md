# Tooling Feedback


## session-end 2026-07-08
- AskUserQuestion for execute-scope was denied; operator chose to end the session instead of starting /stack-control:execute — no tool defect, just a workflow choice.

## session-end 2026-07-12
- run_in_background bash jobs are killed by the harness after a while (the corpus render + the tailscale http.server both got killed mid-run); had to relaunch long-lived/long-running jobs as detached host processes (nohup + disown, no setsid on macOS) to survive. Cost several restarts.
- stackctl roadmap add <id> --depends-on A --depends-on B kept only the last value (B); needed a follow-up 'roadmap add-edge --field depends-on --to A' to add the first. Repeated --depends-on flags should accumulate (or the help should say single-value).
