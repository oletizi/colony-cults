import { sourceLayout } from '@/archive/location';
import type { Source } from '@/model/source';

/** Canonical SSOT archive label for the Gallica/BnF copy. */
export const CANONICAL_GALLICA = 'Gallica / BnF';
/** Canonical SSOT archive label for the State Library of Queensland copy. */
const CANONICAL_SLQ = 'State Library of Queensland';
/** Statuses that denote a copy the project is actively holding. */
export const ACTIVE_STATUSES = new Set(['collecting', 'collected', 'archived']);

/** Free-text acquisition status (tracker) -> closed vocab. */
export const TRACKER_STATUS = new Map<string, string>([
  ['wanted', 'wanted'],
  ['to collect', 'to-collect'],
  ['to locate', 'to-collect'],
  ['to search', 'to-collect'],
  ['to contact', 'to-collect'],
  ['in progress', 'collecting'],
  ['collecting', 'collecting'],
  ['collected', 'collected'],
  ['archived', 'archived'],
]);

/** Archive-side `mirror_status` (register / stub) -> closed vocab. */
export const MIRROR_STATUS = new Map<string, string>([
  ['pending', 'to-collect'],
  ['in-progress', 'collecting'],
  ['in progress', 'collecting'],
  ['complete', 'collected'],
  ['mirrored', 'collected'],
  ['collected', 'collected'],
  ['archived', 'archived'],
]);

/** Map a raw status through a table; THROW (fail loud) on any unmapped value. */
export function mapStatus(table: Map<string, string>, raw: string, kind: string): string {
  const mapped = table.get(raw.trim().toLowerCase());
  if (mapped === undefined) {
    throw new Error(
      `migrate: unmappable ${kind} status "${raw}" -- add an explicit mapping ` +
        `(no silent default)`,
    );
  }
  return mapped;
}

/** A non-empty trimmed cell, or `undefined` for an absent/blank one. */
export function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Require a cell to be present and non-empty (fail loud otherwise). */
export function requireCell(row: Record<string, string>, key: string, where: string): string {
  const value = nonEmpty(row[key]);
  if (value === undefined) {
    throw new Error(`migrate: ${where} is missing required column "${key}"`);
  }
  return value;
}

/** Canonicalize an archive label to the SSOT's stable form. */
export function canonicalizeArchive(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (
    lower.includes('gallica') ||
    lower.includes('bnf') ||
    lower.includes('bibliotheque nationale')
  ) {
    return CANONICAL_GALLICA;
  }
  if (lower.includes('queensland') || lower.includes('slq')) {
    return CANONICAL_SLQ;
  }
  return raw.trim();
}

/** Split a combined `A / B / C` archive label into canonical, de-duped labels. */
export function splitArchives(raw: string): string[] {
  const seen = new Set<string>();
  for (const segment of raw.split('/')) {
    const trimmed = segment.trim();
    if (trimmed.length > 0) {
      seen.add(canonicalizeArchive(trimmed));
    }
  }
  return [...seen];
}

/** Extract a Gallica `ark:/12148/...` from a catalog URL, if present. */
export function extractArk(url: string): string | undefined {
  const match = url.match(/ark:\/12148\/[^\s?#]+/);
  return match === null ? undefined : match[0];
}

/** Extract the SLQ record id + call number from free-text notes, if present. */
export function extractSlqIds(notes: string | undefined): string | undefined {
  if (notes === undefined) {
    return undefined;
  }
  const idMatch = notes.match(/slq_alma\d+/i);
  if (idMatch === null) {
    return undefined;
  }
  const parts = [`SLQ record id: ${idMatch[0]}`];
  // The call number itself can contain periods (e.g. "RBS 919.5 004"), so match
  // up to a period that ENDS the sentence (followed by whitespace or EOL),
  // falling back to a run terminated by a comma/semicolon.
  const callMatch =
    notes.match(/call number\s+(.+?)\.(?:\s|$)/i) ?? notes.match(/call number\s+([^,;]+)/i);
  if (callMatch !== null) {
    parts.push(`call number: ${callMatch[1].trim()}`);
  }
  return parts.join('; ');
}

/**
 * Detect a work-level ISBN-10/ISBN-13 in a free-text reference cell (the
 * tracker's `url_or_reference` column doubles as an ISBN slot for sources
 * with no URL, e.g. PB-S001). Strips spaces/hyphens, then requires either a
 * bare ISBN-10 (10 chars: 9 digits + a trailing digit or `X`) or a bare
 * ISBN-13 (13 digits starting `978`/`979`). A URL or any other free-text
 * reference does not match and returns `undefined` -- no fabrication.
 */
export function detectIsbn(ref: string): string | undefined {
  const stripped = ref.replace(/[\s-]/g, '');
  if (/^\d{9}[\dXx]$/.test(stripped)) {
    return stripped.toUpperCase();
  }
  if (/^(978|979)\d{10}$/.test(stripped)) {
    return stripped;
  }
  return undefined;
}

/** Whether the source's material type denotes a periodical/newspaper serial. */
export function detectKind(typeColumn: string): Source['kind'] {
  const lower = typeColumn.toLowerCase();
  return lower.includes('periodical') || lower.includes('newspaper')
    ? 'periodical'
    : 'monograph';
}

/** The registered archive slug for a source, or `undefined` when unregistered. */
export function safeSlug(sourceId: string): string | undefined {
  try {
    return sourceLayout(sourceId).slug;
  } catch {
    // No registered layout -> the source has no archive location, hence no
    // slug/census. This is genuine absence, not a swallowed failure.
    return undefined;
  }
}
