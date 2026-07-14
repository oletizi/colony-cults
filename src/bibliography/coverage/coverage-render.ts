import type {
  WorkBundleCoverage,
  CoverageRegister,
  CoverageReport,
  CoverageSearchHistory,
  RegisterEntry,
} from '@/bibliography/coverage/coverage-model';

/**
 * Render a {@link CoverageReport} as either deterministic machine JSON or
 * human-readable text (specs/007 contracts/bib-coverage.md). BOTH forms print
 * every section (contract Output sections 1-4) even when empty, and both
 * uphold the assertable invariants:
 *
 * - INV-1: NEVER a headline coverage percentage -- this module emits no `%`.
 * - INV-2: an unknown gap/denominator renders as the literal `unknown`, never
 *   a blank, `0`, or a percentage.
 *
 * Every section prints its per-row detail (per-work-bundle counts, evidence
 * distribution, the register with its ungrouped bucket + suspected sub-listing,
 * and the search-history matrix + repository rollup), and empty sections print
 * `(none)` cleanly.
 */
export function renderCoverage(report: CoverageReport, opts: { json: boolean }): string {
  return opts.json ? renderJson(report) : renderText(report);
}

/**
 * Deterministic JSON: `CoverageReport`'s key order is fixed by construction
 * (see `buildCoverageReport`), so `JSON.stringify` is byte-stable across runs
 * against identical input (contract Deterministic requirement / INV-5).
 */
function renderJson(report: CoverageReport): string {
  return JSON.stringify(report, null, 2);
}

const NONE = '(none)';

/** Render a `number | 'unknown'` value: numbers as-is, the sentinel literally (INV-2). */
function renderCountable(value: number | 'unknown'): string {
  return typeof value === 'number' ? String(value) : value;
}

function renderPerWorkBundle(perWorkBundle: WorkBundleCoverage[], lines: string[]): void {
  lines.push('Per-work-bundle counts:');
  if (perWorkBundle.length === 0) {
    lines.push(`  ${NONE}`);
    return;
  }
  for (const workBundle of perWorkBundle) {
    lines.push(`  work-bundle ${workBundle.workBundle}`);
    const members =
      workBundle.membersByLifecycleState.length === 0
        ? NONE
        : workBundle.membersByLifecycleState
            .map((bucket) => `${bucket.state} ${bucket.count}`)
            .join(' | ');
    lines.push(`    members: ${members}   (actual works: ${workBundle.actualMemberCount})`);
    lines.push(
      `    believed extent (knownMemberCount): ${renderCountable(workBundle.knownMemberCount)}` +
        `        gap: ${renderCountable(workBundle.gap)}`,
    );
  }
}

function renderEvidenceClasses(
  distribution: CoverageReport['evidenceClassDistribution'],
  lines: string[],
): void {
  lines.push('Evidence classes:');
  if (distribution.length === 0) {
    lines.push(`  ${NONE}`);
    return;
  }
  lines.push(
    `  ${distribution.map((bucket) => `${bucket.class} ${bucket.count}`).join(' | ')}`,
  );
}

/** A basis suffix, present only when the entry carries free-form basis prose. */
function basisSuffix(entry: RegisterEntry): string {
  return entry.basis !== undefined ? ` (basis: ${entry.basis})` : '';
}

/** An unresolved reference: what was cited, its basis, and the source that cites it. */
function renderReferenceEntry(entry: RegisterEntry): string {
  return `- ${entry.citedAs ?? ''}${basisSuffix(entry)}  [cited in ${entry.owner}]`;
}

/** A suspected gap: what is inferred to exist and (always) why. */
function renderSuspectedEntry(entry: RegisterEntry): string {
  return `- ${entry.description ?? ''}${basisSuffix(entry)}`;
}

/** References (only) grouped by work-bundle, then the ungrouped "[no work-bundle]" bucket. */
function renderReferences(register: CoverageRegister, lines: string[]): void {
  lines.push('Unresolved references:');

  if (register.byWorkBundle.length === 0) {
    lines.push(`  ${NONE}`);
  } else {
    for (const bucket of register.byWorkBundle) {
      lines.push(`  ${bucket.workBundle}:`);
      const references = bucket.entries.filter((entry) => entry.kind === 'reference');
      if (references.length === 0) {
        lines.push(`    ${NONE}`);
      } else {
        for (const entry of references) {
          lines.push(`    ${renderReferenceEntry(entry)}`);
        }
      }
    }
  }

  lines.push('  [no work-bundle]:');
  if (register.ungrouped.length === 0) {
    lines.push(`    ${NONE}`);
  } else {
    for (const entry of register.ungrouped) {
      lines.push(`    ${renderReferenceEntry(entry)}`);
    }
  }
}

/** The suspected-gaps sub-listing, grouped by work-bundle (only those that have any). */
function renderSuspected(register: CoverageRegister, lines: string[]): void {
  lines.push('  suspected:');
  const withSuspected = register.byWorkBundle
    .map((bucket) => ({
      workBundle: bucket.workBundle,
      entries: bucket.entries.filter((entry) => entry.kind === 'suspected'),
    }))
    .filter((bucket) => bucket.entries.length > 0);

  if (withSuspected.length === 0) {
    lines.push(`    ${NONE}`);
    return;
  }
  for (const bucket of withSuspected) {
    lines.push(`    ${bucket.workBundle}:`);
    for (const entry of bucket.entries) {
      lines.push(`      ${renderSuspectedEntry(entry)}`);
    }
  }
}

function renderRegister(register: CoverageRegister, lines: string[]): void {
  renderReferences(register, lines);
  renderSuspected(register, lines);
}

function renderSearchHistory(history: CoverageSearchHistory, lines: string[]): void {
  lines.push('Search history:');
  if (history.matrix.length === 0) {
    lines.push(`  ${NONE}`);
  } else {
    for (const cell of history.matrix) {
      const open = cell.openQuestions.length === 0 ? NONE : cell.openQuestions.join('; ');
      lines.push(
        `  ${cell.scope} x ${cell.repository}  last: ${cell.lastSearched}  open: ${open}`,
      );
    }
  }

  lines.push('  Per-scope closure:');
  if (history.byScope.length === 0) {
    lines.push(`    ${NONE}`);
  } else {
    for (const scope of history.byScope) {
      lines.push(
        `    ${scope.scope}  last: ${scope.lastSearched}  closure: ${scope.measuredClosure}` +
          `  open: ${scope.openQuestions.length}`,
      );
    }
  }

  lines.push('  Repository rollup:');
  if (history.byRepository.length === 0) {
    lines.push(`    ${NONE}`);
  } else {
    for (const rollup of history.byRepository) {
      lines.push(
        `    ${rollup.repository}  last: ${rollup.lastSearched}  open: ${rollup.openQuestions.length}`,
      );
    }
  }
}

/** The human-readable shell: every section header, cleanly empty when there is no data. */
function renderText(report: CoverageReport): string {
  const lines: string[] = [];
  renderPerWorkBundle(report.perWorkBundle, lines);
  renderEvidenceClasses(report.evidenceClassDistribution, lines);
  renderRegister(report.register, lines);
  renderSearchHistory(report.searchHistory, lines);
  return lines.join('\n');
}
