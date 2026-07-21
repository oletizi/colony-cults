---
id: TASK-4
title: cli-bin-entry
status: Done
assignee: []
created_date: '2026-07-08 14:28'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
package.json bin maps gallica -> src/index.ts (TypeScript); an npm-installed/linked bin cannot run TS without a loader and there is no shebang/build. Everyday use via 'npm run gallica' (tsx) works, but the bin field is a latent trap. Fix: drop bin until a compiled entry exists, or add a build + '#!/usr/bin/env node' JS entrypoint. (govern MEDIUM)

Resolved by feature/rename-cli-bib (2026-07-20): bin renamed gallica -> bib and
now points at an esbuild bundle (dist/index.js) with a node shebang, so a
linked/installed bin runs under plain node with no tsx. `prepare` builds on
install. Verified by tests/integration/built-bin.test.ts.
<!-- SECTION:DESCRIPTION:END -->
