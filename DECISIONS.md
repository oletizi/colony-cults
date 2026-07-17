# Decision Log

This file records durable project decisions. Each entry should state what changed, why it changed, and any consequences for future work.

## 2026-07-07

### Adopt governance files as required project infrastructure

- Status: accepted
- Basis: the repository is the public source of truth and must survive context loss.
- Consequence: session entry, exit, state, and next-action guidance should live in versioned files, not only in chat history or ad hoc notes.

### Optimize for durable commits over conversational state

- Status: accepted
- Basis: uncommitted work is easy to lose and hard to reconstruct.
- Consequence: agents should make small coherent commits, push frequently, and prefer preserving partial progress over keeping work ephemeral.

### Invoke session ceremonies manually until automation exists

- Status: accepted
- Basis: this repository is not using stack-control, but it still needs explicit session-start and session-end behavior.
- Consequence: contributors may trigger the ceremony with direct instructions such as "run session start" and "run session end", and the agent should execute the repository's file-driven governance workflow.

## 2026-07-17

### The store-raw-responses convention is a frugality convenience, waivable per-source when a source's ToS conflicts

- Status: accepted
- Basis: Persisting raw repository responses in the repo (`bibliography/repository-responses/`) exists to be frugal and polite to the source service — avoid re-hitting it — not as a hard requirement. The Trove API Terms of Use (reviewed 2026-07-17, SRCH-context on PB-P005 / TASK-33) permit caching metadata for at most 30 days (clause 9) and require its removal if withdrawn from Trove (clause 10), which is structurally incompatible with a permanent, public, redistributed git repository. A politeness convenience must yield to a binding source ToS.
- Consequence: For Trove specifically, do NOT persist raw API/search responses; re-fetch instead, and record only DERIVED facts (result counts, a few article IDs) in the search-log with Trove attribution (API terms clause 11). Content (newspaper full text / images) is never pulled via the Trove API (metadata-only scope; 2025 NLA enforcement treats API content extraction as a breach) — public-domain articles are acquired out-of-band on their own pre-1955 basis. Gallica and the Internet Archive are unaffected (open / compatible licences) and keep persisting raw responses. General rule: when a source's terms forbid retention/redistribution, the store-responses convention is waived for that source; the search-log's derived-facts entry remains the durable artifact.
