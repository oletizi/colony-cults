---
id: TASK-43
title: sourcequery-production-tailscale-runner
status: To Do
assignee: []
created_date: '2026-07-18 02:26'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/014-source-query-client/contracts/interfaces.md
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
US2 exit-node escalation is fully implemented and unit/integration tested against FakeTailscaleRunner, but no production exec-backed TailscaleRunner exists (execs 'tailscale exit-node list' / 'tailscale status --json' / 'tailscale set --exit-node='). interfaces.md specifies it; no tasks.md task builds it. Consequence: bib query-source injects the fail-loud unavailableTailscaleRunner, so a real hard block surfaces as exit 1 'Tailscale unavailable' instead of the exit-3 escalation. Needed to make US2 live-wireable end to end. FR-015/SC-006 require the test path stay on the fake; this is the production impl + CLI wiring only.
<!-- SECTION:DESCRIPTION:END -->
