import type {
  CampaignCoverage,
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
 * The text form is a shell: later section tasks (T011/T016/T019/T025/T028)
 * flesh out the per-row detail, but the section headers are stable from here.
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

function renderPerCampaign(perCampaign: CampaignCoverage[], lines: string[]): void {
  lines.push('Per-campaign counts:');
  if (perCampaign.length === 0) {
    lines.push(`  ${NONE}`);
    return;
  }
  for (const campaign of perCampaign) {
    lines.push(`  Campaign ${campaign.campaign}`);
    const members =
      campaign.membersByLifecycleState.length === 0
        ? NONE
        : campaign.membersByLifecycleState
            .map((bucket) => `${bucket.state} ${bucket.count}`)
            .join(' | ');
    lines.push(`    members: ${members}   (actual works: ${campaign.actualMemberCount})`);
    lines.push(
      `    believed extent (knownMemberCount): ${renderCountable(campaign.knownMemberCount)}` +
        `        gap: ${renderCountable(campaign.gap)}`,
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

function renderRegisterEntry(entry: RegisterEntry): string {
  const label = entry.kind === 'reference' ? entry.citedAs ?? '' : entry.description ?? '';
  const basis = entry.basis !== undefined ? ` (basis: ${entry.basis})` : '';
  return `- ${label}${basis}`;
}

function renderRegister(register: CoverageRegister, lines: string[]): void {
  lines.push('Unresolved references:');

  lines.push('  by campaign:');
  if (register.byCampaign.length === 0) {
    lines.push(`    ${NONE}`);
  } else {
    for (const bucket of register.byCampaign) {
      lines.push(`    ${bucket.campaign}:`);
      if (bucket.entries.length === 0) {
        lines.push(`      ${NONE}`);
      } else {
        for (const entry of bucket.entries) {
          lines.push(`      ${renderRegisterEntry(entry)}`);
        }
      }
    }
  }

  lines.push('  [no campaign]:');
  if (register.ungrouped.length === 0) {
    lines.push(`    ${NONE}`);
  } else {
    for (const entry of register.ungrouped) {
      lines.push(`    ${renderRegisterEntry(entry)}`);
    }
  }
}

function renderSearchHistory(history: CoverageSearchHistory, lines: string[]): void {
  lines.push('Search history:');
  if (history.matrix.length === 0) {
    lines.push(`  ${NONE}`);
  } else {
    for (const cell of history.matrix) {
      const open = cell.openQuestions.length === 0 ? NONE : cell.openQuestions.join('; ');
      lines.push(
        `  ${cell.campaign} x ${cell.repository}  last: ${cell.lastSearched}  open: ${open}`,
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
  renderPerCampaign(report.perCampaign, lines);
  renderEvidenceClasses(report.evidenceClassDistribution, lines);
  renderRegister(report.register, lines);
  renderSearchHistory(report.searchHistory, lines);
  return lines.join('\n');
}
