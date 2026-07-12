# Audit Log

Durable record of audit findings + their dispositions. Status values: `open` → `fixed-<sha>` → `verified-<date>`, or `acknowledged-<date>` with a substantive reason.

---

## impl:feature/edition-publishing (govern --mode implement, 2026-07-12)

The cross-model audit-barrage (claude / sonnet / codex-gpt-5.5) was **killed by the
harness before convergence** (the known environmental limitation in this session — it
cannot complete the multi-round barrage; same as impl:feature/corpus-print-pdf). Findings
were **harvested from the partial fleet output** and from a controller whole-feature review,
fixed, and re-verified; convergence was then recorded via `govern --override` after
extensive live validation (64 publish tests + full suite green + typecheck clean + all
`src/pdf/publish/*` modules ≤ 500 lines).

- **AUDIT-BARRAGE-codex-01** — HIGH — `validatePublicationRightsBasis` accepted a
  whitespace-only `rightsBasis` (checked `!== ''` without trimming), so a provenance-empty
  published record could validate as clean while the publish rights-gate (which trims) would
  have refused it. **fixed-f992e09** (trim before the emptiness check + whitespace-only test).
- **CONTROLLER-01** — MEDIUM — `publishIssue` uploaded the PDF to the store *before* reading
  the build `input.json` for the page count; a missing/malformed `input.json` then failed the
  issue *after* the upload, orphaning an unrecorded artifact. **fixed-f992e09** (read build
  metadata before the side-effecting upload).

Fleet coverage note (US2 observability): the barrage was a **degraded/killed** run — claude
lane stalled at 57 events, sonnet mid-review, codex emitted one HIGH finding. Not a
full-convergence quiet round; the override records this explicitly rather than treating the
killed run as clean.
