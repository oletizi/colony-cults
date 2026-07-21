/**
 * Mechanical publication-date grounding for the {@link PapersPastAdapter}
 * (specs/015-papers-past-acquisition). Extracted from `adapter.ts` to keep that
 * file focused (and under the module size limit).
 *
 * Papers Past encodes the publication date in the article code (`oid`), e.g.
 * `HNS18840103.2.19.3` -> `1884-01-03`. This is a DETERMINISTIC parse, never a
 * model call; it fails loud (no fabrication) on a missing or implausible date.
 */

import type { GroundedField } from '@/extraction/structured-extractor';
import type { ParsedArticle } from '@/repository/papers-past/types';

/**
 * Build the mechanical grounded `date` field for an article, derived from the
 * article code where Papers Past encodes the publication date. {@link GroundedField}
 * hard-codes `provenance.modelAssisted: true`, so `engine`/`model` NAME the
 * mechanical parse honestly (the Internet Archive `rights.ts` convention) rather
 * than inventing a model. `now` supplies the provenance timestamp. Fails loud (no
 * fabrication) if the article code carries no valid `YYYYMMDD` date.
 */
export function mechanicalDateField(parsed: ParsedArticle, now: () => string): GroundedField<string> {
  const match = /^[A-Za-z]+(\d{4})(\d{2})(\d{2})\./.exec(parsed.articleId);
  if (match === null) {
    throw new Error(
      `PapersPastAdapter: cannot derive a publication date from article code ` +
        `"${parsed.articleId}" (expected <PAPER><YYYYMMDD>.<edition>.<article>) -- ` +
        'refusing to fabricate a grounded date.',
    );
  }
  const [, year, month, day] = match;
  const yearNum = Number.parseInt(year, 10);
  const monthNum = Number.parseInt(month, 10);
  const dayNum = Number.parseInt(day, 10);
  // Coarse range gate (month 1-12, day 1-31) THEN a real-calendar gate: a UTC
  // date normalises overflow (1884-02-30, non-leap 1885-02-29), so a genuine
  // date round-trips its UTC Y/M/D back to the decoded digits (never Date.now).
  const inRange = monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31;
  const probe = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
  const realCalendarDate =
    probe.getUTCFullYear() === yearNum &&
    probe.getUTCMonth() === monthNum - 1 &&
    probe.getUTCDate() === dayNum;
  if (!inRange || !realCalendarDate) {
    throw new Error(
      `PapersPastAdapter: article code "${parsed.articleId}" encodes an implausible date ` +
        `${year}-${month}-${day} -- refusing to fabricate a grounded date.`,
    );
  }
  const value = `${year}-${month}-${day}`;
  return {
    value,
    evidence: {
      excerpt: parsed.articleId,
      selector: 'link[rel="canonical"] (article code / oid)',
    },
    interpretation:
      'publication date mechanically decoded from the Papers Past article code ' +
      '(YYYYMMDD segment); a fact for the operator to weigh, not a legal determination',
    provenance: {
      modelAssisted: true,
      engine: 'papers-past-mechanical-parse',
      model: 'papers-past-article-code-date',
      promptVersion: 'papers-past-mechanical-v1',
      at: now(),
    },
  };
}
