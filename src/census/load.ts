import { readFileSync } from 'node:fs';
import type { Census, CensusIssue } from '@/model/census';
import {
  childNumber,
  childString,
  requireRecord,
  toArray,
} from '@/gallica/xml';

/**
 * Load and validate a census JSON previously written by `serializeCensus`.
 * Fails loud on a missing/malformed file or a missing field -- there is no
 * fallback census (the small XML-navigation helpers double as JSON validators
 * since both operate on `Record<string, unknown>`).
 */
export function loadCensus(filePath: string): Census {
  const raw = readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`loadCensus: malformed JSON in ${filePath}: ${message}`);
  }

  const doc = requireRecord(parsed, `census ${filePath}`);
  const ctx = `census ${filePath}`;

  const issues: CensusIssue[] = toArray(doc.issues).map((entry, index) => {
    const record = requireRecord(entry, `${ctx} > issues[${index}]`);
    const issueCtx = `${ctx} > issues[${index}]`;
    return {
      ark: childString(record, 'ark', issueCtx),
      date: childString(record, 'date', issueCtx),
      label: childString(record, 'label', issueCtx),
      pageCount: childNumber(record, 'pageCount', issueCtx),
    };
  });

  return {
    sourceId: childString(doc, 'sourceId', ctx),
    gallicaArk: childString(doc, 'gallicaArk', ctx),
    builtAt: childString(doc, 'builtAt', ctx),
    totalIssues: childNumber(doc, 'totalIssues', ctx),
    issues,
  };
}
