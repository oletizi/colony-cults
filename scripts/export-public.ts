/**
 * scripts/export-public.ts
 *
 * US6 (FR-019 / SC-008): produces the public deployment artifact as a
 * DELIBERATE, explicit action — distinct from `site:build`, and never an
 * incidental side effect of it.
 *
 * The corpus is public-domain (rights_status: public-domain); there is no
 * secret content to strip. This script is therefore an EDITORIAL-READINESS
 * gate, not a rights filter: it exists so a public deployment can only be
 * produced by someone consciously choosing to produce one.
 *
 * Scope note (OQ-4, deferred — see specs/005-corpus-browser/spec.md):
 * "what public-domain text/images get published and how" (a curation
 * pipeline beyond "build everything, then confirm you want it published")
 * is an open question the spec explicitly defers. This script implements
 * only the SEAM the spec asks for now: an explicit confirmation gate around
 * running the build and materializing its output as a distinct, named
 * public-export artifact. It does not curate, filter, or select content —
 * doing so is out of scope until OQ-4 is resolved.
 *
 * Usage:
 *   npm run site:export-public                    # blocked: prints why, exits non-zero, no artifact
 *   npm run site:export-public -- --confirm        # confirmed: builds + exports
 *   CORPUS_PUBLIC_EXPORT_CONFIRM=1 npm run site:export-public   # equivalent env-based confirmation
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const BUILD_OUTPUT_DIR = join(REPO_ROOT, 'site', 'dist');
const EXPORT_OUTPUT_DIR = join(REPO_ROOT, 'site', 'public-export');

function isConfirmed(argv: string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes('--confirm') || env.CORPUS_PUBLIC_EXPORT_CONFIRM === '1';
}

function explainAndRefuse(): never {
  const message = [
    '',
    'site:export-public refused: no export produced.',
    '',
    'Producing a public deployment is a DELIBERATE editorial-readiness',
    'decision (FR-019 / SC-008), not an incidental side effect of the',
    'internal build. The corpus is already public-domain, so this gate is',
    'about readiness, not secrecy — but it still requires an explicit,',
    'conscious confirmation before anything is published.',
    '',
    'To proceed, re-run with an explicit confirmation:',
    '  npm run site:export-public -- --confirm',
    'or:',
    '  CORPUS_PUBLIC_EXPORT_CONFIRM=1 npm run site:export-public',
    '',
    'Note: what exactly gets published, and any curation beyond "build the',
    'whole site and confirm you want it public", is OQ-4 in',
    'specs/005-corpus-browser/spec.md — explicitly DEFERRED. This script',
    'only implements the confirmation seam, not a curation pipeline.',
    '',
  ].join('\n');
  process.stderr.write(message);
  process.exit(1);
}

function runBuild(): void {
  const result = spawnSync('npm', ['run', 'site:build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    throw new Error(`Failed to spawn "npm run site:build": ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`"npm run site:build" exited with status ${result.status ?? 'unknown'}`);
  }
  if (!existsSync(BUILD_OUTPUT_DIR)) {
    throw new Error(
      `Build reported success but expected output directory does not exist: ${BUILD_OUTPUT_DIR}`
    );
  }
}

function materializeExport(): void {
  if (existsSync(EXPORT_OUTPUT_DIR)) {
    rmSync(EXPORT_OUTPUT_DIR, { recursive: true, force: true });
  }
  cpSync(BUILD_OUTPUT_DIR, EXPORT_OUTPUT_DIR, { recursive: true });
}

function countHtmlPages(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      count += countHtmlPages(full);
    } else if (entry.endsWith('.html')) {
      count += 1;
    }
  }
  return count;
}

function main(): void {
  if (!isConfirmed(process.argv.slice(2), process.env)) {
    explainAndRefuse();
  }

  process.stdout.write('site:export-public confirmed — building and exporting public deployment...\n\n');

  runBuild();
  materializeExport();

  const pageCount = countHtmlPages(EXPORT_OUTPUT_DIR);

  const summary = [
    '',
    'Public export produced (deliberate action, FR-019 / SC-008).',
    `  Output path : ${EXPORT_OUTPUT_DIR}`,
    `  Pages       : ${pageCount} HTML page(s)`,
    '  Content     : public-domain (rights_status: public-domain) — no rights filtering applied',
    '  Curation    : none beyond this confirmation gate (OQ-4 deferred, see spec.md)',
    '',
  ].join('\n');
  process.stdout.write(summary);
}

main();
