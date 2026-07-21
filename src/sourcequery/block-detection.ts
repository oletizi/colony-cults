/**
 * Block / result / empty classification (Phase 1, T010).
 *
 * Implements research decision R1: a navigation outcome is a HARD BLOCK only on
 * a positive signal (blocking HTTP status, navigation drop, or a challenge
 * fingerprint on a page that LACKS the result container). A page that renders
 * the expected result container — even with zero rows — is a legitimate empty
 * result, never a block. When neither a positive block signal nor the result
 * container is present, the page CANNOT be classified: we THROW (fail-loud,
 * Principle V) rather than guess or fabricate a block.
 */

import { parse } from 'node-html-parser';
import type { BlockEvidenceKind, PageResult } from '@/sourcequery/types';
import type { SourceConfig } from '@/sourcequery/source-config';

/** Discriminated classification of a single navigation outcome. */
export type BlockClassification =
  | { outcome: 'result' }
  | { outcome: 'empty' }
  | { outcome: 'block'; kind: BlockEvidenceKind; detail: string };

/**
 * Known challenge/WAF fingerprints (R1). Each entry is a case-insensitive
 * substring test against the page body; `label` is the human-readable name
 * recorded in the block detail.
 */
interface Fingerprint {
  label: string;
  test: (lowerHtml: string) => boolean;
}

/** Simple case-insensitive substring fingerprint. */
function substring(label: string, needle: string): Fingerprint {
  const lowerNeedle = needle.toLowerCase();
  return { label, test: (lowerHtml) => lowerHtml.includes(lowerNeedle) };
}

const FINGERPRINTS: readonly Fingerprint[] = [
  substring('Incapsula incident ID', 'Incapsula incident ID'),
  substring('Request unsuccessful', 'Request unsuccessful'),
  substring('Just a moment', 'Just a moment'),
  substring('Attention Required', 'Attention Required'),
  substring('cf-chl', 'cf-chl'),
  substring('Anubis', 'Anubis'),
  {
    // The "automatic … redirect … challenge" triad: all three words present.
    label: 'automatic/redirect/challenge triad',
    test: (lowerHtml) =>
      lowerHtml.includes('automatic') &&
      lowerHtml.includes('redirect') &&
      lowerHtml.includes('challenge'),
  },
];

/**
 * True when `html` carries a known WAF/challenge fingerprint (Incapsula, the
 * automatic/redirect/challenge triad, Cloudflare, Anubis, …). Unlike
 * {@link classify}, this needs no {@link SourceConfig} / result container — it is
 * a pure content probe, so a caller OUTSIDE the query client (e.g. the acquire
 * adapter, whose page failed to parse as an article) can tell a WAF challenge
 * interstitial apart from a genuinely non-article page and surface the right
 * remediation (the stale-cookie hint) instead of a misleading parse error.
 */
export function looksLikeWafChallenge(html: string): boolean {
  const lowerHtml = html.toLowerCase();
  return FINGERPRINTS.some((fp) => fp.test(lowerHtml));
}

/** True when the source's result container is present in the HTML. */
function hasResultContainer(html: string, config: SourceConfig): boolean {
  // Defensive parse: on a parser throw, let it propagate (fail-loud, no fallback).
  const root = parse(html);
  return root.querySelector(config.resultSelector) !== null;
}

/** True when `status` is one the sources treat as a hard block (403 / 429 / 5xx). */
function isBlockingStatus(status: number): boolean {
  return status === 403 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Classifies a navigation outcome as a result, a legitimate empty, or a hard
 * block. See R1. Throws when the page carries no positive block signal AND no
 * result container (unclassifiable — fail-loud).
 */
export function classify(page: PageResult, config: SourceConfig): BlockClassification {
  // 1. Status block: a blocking HTTP status is a positive signal on its own.
  if (page.status !== null && isBlockingStatus(page.status)) {
    return { outcome: 'block', kind: 'status', detail: `HTTP ${page.status}` };
  }

  // 2. Drop block: a navigation error / timeout / connection drop.
  if (page.errored) {
    return {
      outcome: 'block',
      kind: 'drop',
      detail: 'Navigation error, timeout, or connection drop before the page settled',
    };
  }

  const containerPresent = hasResultContainer(page.html, config);

  // 3. Challenge block: a known fingerprint AND no result container rendered.
  if (!containerPresent) {
    const lowerHtml = page.html.toLowerCase();
    const matched = FINGERPRINTS.find((fp) => fp.test(lowerHtml));
    if (matched) {
      return { outcome: 'block', kind: 'challenge', detail: `challenge fingerprint matched: ${matched.label}` };
    }
  }

  // 4. Result container present -> split result vs. legitimate empty by count.
  if (containerPresent) {
    const summary = config.parseSummary(page.html);
    return summary.count > 0 ? { outcome: 'result' } : { outcome: 'empty' };
  }

  // 5. No positive block signal AND no result container: unclassifiable.
  throw new Error(
    'Page could not be classified: the result container ' +
      `("${config.resultSelector}") is not present and no positive block signal ` +
      '(blocking HTTP status, navigation drop, or known challenge fingerprint) was found. ' +
      'Refusing to guess result/empty or fabricate a block without evidence.'
  );
}
