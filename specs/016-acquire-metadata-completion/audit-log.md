---
slug: 016-acquire-metadata-completion
targetVersion: ""
---

# Audit log — 016-acquire-metadata-completion

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-01 — The completion tail silently skips a fetched-but-not-injected acquire — contradicting its own "fails loud" comment

Finding-ID: AUDIT-20260719-01 (claude-01 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/sourcegroup/acquire.ts (completion-tail gate, new block ~446–470; AcquireInput doc ~155–175)

The tail runs only when `input.dryRun !== true && (mirroredMasters || completionInjected)`, where `mirroredMasters = acquisition.assets.length > 0` and `completionInjected = input.completionObjectStore !== undefined || input.gather !== undefined`. A Gallica-shaped acquire returns `assets: []`, so `mirroredMasters` is false; the tail then runs *only if the caller injected `gather` or `completionObjectStore`*. If a Gallica (or any fetch-only) acquire actually fetched per-page masters to the archive but the caller did **not** inject completion machinery, all three predicates are false, the `if` is skipped, and `runAcquire` falls straight through to returning success — status stays `to-collect`, bytes orphaned. That is precisely the Principle XV violation this feature exists to make impossible.

Worse, the `reconcileArchiveRoot` doc comment asserts the opposite: "Absent ⇒ the Gallica completion tail cannot run and **fails loud** (never silently skips advancing a fetched copy)." The code does not fail loud — absence of the machinery makes the guard false and the tail is silently skipped. An adopter (or unattended agent) reading that comment will believe the weld is mechanical when it is in fact conditional on optional injected parameters. The structural defect is that `runAcquire` cannot distinguish "pure dispatch, nothing to complete" from "fetched bytes, completion needed but machinery not wired" — both present as `mirroredMasters=false, completionInjected=false`. A fix needs a positive signal that a fetch wrote durable bytes (e.g. a `fetched`/`didWrite` flag on the acquisition result) so the tail can fail loud when that signal is set but no completion store/gather is available, instead of trusting the caller to always inject.

### AUDIT-20260719-02 — Zero-asset B2-direct acquires are misrouted into the Gallica reconcile path

Finding-ID: AUDIT-20260719-02
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire.ts:464-475

The completion tail decides to run when either masters were returned or *any* completion dependency was injected, then delegates path selection to `runReconcile` based on the persisted record shape. For a B2-direct CLI acquire, the CLI injects `completionObjectStore`; if the selected B2-direct adapter legitimately returns `assets: []` on a non-dry-run path, `mirroredMasters` is false but `completionInjected` is true, so `runReconcile` is called with only `objectStore` and no `archiveRoot`/`gather`. Because the record has no assets, `runReconcile` falls through to its archive-provenance path and throws for missing Gallica dependencies instead of treating this as a zero-master B2-direct outcome.

This shape is not hypothetical: the museum adapter has a documented HTML-only path that returns `assets: []` with `complete: true`, and dry-run is not the only empty-assets producer. The blast radius is high because an operator can hit this through normal `bib acquire` on a B2-direct record that mirrors no master bytes; the new completion tail converts an otherwise valid acquisition/cataloging outcome into a misleading Gallica-provenance failure. A reasonable fix is to make the completion path use an explicit acquisition/repository shape signal, or an explicit adapter outcome, rather than inferring Gallica-vs-B2 solely from `assets.length` plus which dependencies happened to be injected.
