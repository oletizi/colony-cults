/**
 * Escape a string for literal (non-metacharacter) use inside a `RegExp`
 * pattern.
 *
 * ONE implementation, shared. Two corpus-config seams build a `RegExp` from a
 * configured, corpus-supplied prefix — `@/sourcegroup/id-alloc`'s member-file
 * scan (T012) and `@/corpus/source-filename-policy`'s enumeration filter
 * (T023, FR-018) — and a raw interpolation in either would silently corrupt
 * the pattern for any prefix containing `.`, `*`, `+`, etc. This module exists
 * so there is exactly one escaper rather than a per-seam copy.
 *
 * Defensive by design: the prefix grammar (FR-002a,
 * `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$`) means `-` is the only non-alphanumeric
 * character a valid prefix can contain today, and `-` is not a regex
 * metacharacter outside a character class — but this escapes the full
 * metacharacter set anyway rather than relying on that grammar holding
 * forever.
 */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
