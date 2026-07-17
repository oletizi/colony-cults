/**
 * scripts/backfill-translation-labels.ts
 *
 * One-shot migration: reconcile each translation artifact's `translation` label
 * with its content so the empty<=>untranslatable invariant holds across the
 * pre-existing corpus (see `validateTranslationLabels`). An EMPTY artifact
 * becomes `untranslatable`; a NON-EMPTY one `machine-assisted`. Text-only
 * surgical edit of the one `translation:` line -- no re-serialize, no re-OCR,
 * no re-translation.
 *
 * Usage: COLONY_ARCHIVE_ROOT=/path/to/archive tsx scripts/backfill-translation-labels.ts
 *        (or pass the archive root as argv[2])
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const TRANSLATION_TYPES = new Set([
  '"corrected-french-text"',
  '"english-translation"',
]);

function* walkYml(dir: string): Generator<string> {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkYml(full);
    } else if (entry.isFile() && entry.name.endsWith('.yml')) {
      yield full;
    }
  }
}

function main(): void {
  const archiveRoot = process.env.COLONY_ARCHIVE_ROOT ?? process.argv[2];
  if (archiveRoot === undefined || archiveRoot.trim().length === 0) {
    throw new Error(
      'backfill-translation-labels: set COLONY_ARCHIVE_ROOT (or pass argv[2])',
    );
  }
  let fixed = 0;
  let ok = 0;
  for (const yml of walkYml(path.join(archiveRoot, 'archive'))) {
    const raw = readFileSync(yml, 'utf-8');
    const typeMatch = raw.match(/^type: (".*")$/m);
    if (typeMatch === null || !TRANSLATION_TYPES.has(typeMatch[1])) {
      continue;
    }
    const textPath = yml.replace(/\.yml$/, '');
    if (!existsSync(textPath)) {
      throw new Error(`backfill-translation-labels: no text file for ${yml}`);
    }
    const isEmpty = readFileSync(textPath, 'utf-8').trim().length === 0;
    const expected = isEmpty ? 'untranslatable' : 'machine-assisted';
    const current = raw.match(/^translation: "([^"]*)"/m)?.[1];
    if (current === expected) {
      ok += 1;
      continue;
    }
    const updated = raw.replace(
      /^translation: "[^"]*"/m,
      `translation: "${expected}"`,
    );
    if (updated === raw) {
      throw new Error(`backfill-translation-labels: no translation line in ${yml}`);
    }
    writeFileSync(yml, updated);
    fixed += 1;
    console.log(
      `${current ?? '(absent)'} -> ${expected}  ${path.relative(archiveRoot, yml)}`,
    );
  }
  console.log(`backfill-translation-labels: ${fixed} relabeled, ${ok} already correct`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
