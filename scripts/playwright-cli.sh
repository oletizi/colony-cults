#!/usr/bin/env bash
set -euo pipefail

# Repo-local fallback for Playwright CLI when the Codex skill wrapper is absent.
exec npx --yes @playwright/cli@latest "$@"
