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
