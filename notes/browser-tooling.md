# Browser Tooling

This repository sometimes needs a real browser to inspect JavaScript-heavy catalogues or interfaces protected by anti-bot checks.

## Current working path

Use the repo-local Playwright CLI wrapper:

```bash
./scripts/playwright-cli.sh install-browser chromium
./scripts/playwright-cli.sh open https://example.com
./scripts/playwright-cli.sh snapshot
```

Validated in this environment on 2026-07-07:

- `./scripts/playwright-cli.sh open https://example.com`
- `./scripts/playwright-cli.sh snapshot`
- `./scripts/playwright-cli.sh requests`

These commands successfully opened a browser session, captured a snapshot, and listed network activity.

The wrapper is intentionally thin. It falls back to:

```bash
npx --yes @playwright/cli@latest ...
```

## Why this exists

The Codex skill instructions referenced a wrapper path under `$HOME/.codex/skills/playwright/scripts/playwright_cli.sh`, but that path was not present in this environment during `PB-P001` research.

This repo-local wrapper removes that dependency and gives future sessions a stable entrypoint.

## Usage pattern

1. Install a browser if none are present.
2. Open the target page.
3. Run `snapshot` to get stable element refs.
4. Re-snapshot after navigation or major UI changes.
5. Use browser automation only when simpler terminal or web-search routes are blocked or incomplete.

## Research-specific use cases

- Gallica `issue by date` views
- SLQ catalogue pages that depend on JavaScript rendering
- Rights or download buttons not visible in static HTML
