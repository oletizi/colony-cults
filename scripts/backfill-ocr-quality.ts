/**
 * scripts/backfill-ocr-quality.ts
 *
 * One-shot migration to satisfy the OCR-quality gate (`bib validate`'s
 * `ocr-quality-missing`): stamp a computed `ocr_quality` block onto every
 * pre-existing `type: ocr-text` artifact that predates the mandatory-quality
 * pipeline. Text-only -- it scores each artifact's already-committed
 * `issue.txt` with aspell (no image restore, no re-OCR).
 *
 * Usage: COLONY_ARCHIVE_ROOT=/path/to/archive tsx scripts/backfill-ocr-quality.ts
 *        (or pass the archive root as argv[2])
 *
 * Idempotent: an artifact that already carries `ocr_quality` is skipped.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { assessOcrQuality } from '@/ocr/quality';
import type { OcrQuality } from '@/archive/provenance';
import { defaultOcrCommandRunner } from '@/ocr/run';

/** Provenance `language` (human) -> Tesseract code understood by assessOcrQuality. */
const HUMAN_TO_TESSERACT: Readonly<Record<string, string>> = {
  French: 'fra',
  English: 'eng',
  Italian: 'ita',
};

function tesseractLangFor(human: string): string {
  // "English/Italian" -> primary "English".
  const primary = human.split('/')[0].trim();
  const code = HUMAN_TO_TESSERACT[primary];
  if (code === undefined) {
    throw new Error(
      `backfill-ocr-quality: no Tesseract mapping for language "${human}" ` +
        `-- add it to HUMAN_TO_TESSERACT`,
    );
  }
  return code;
}

/**
 * The exact `ocr_quality:` block `serializeProvenance` emits, so a later strict
 * parse round-trips. Inserted textually (not via full re-serialize) so
 * artifacts that legitimately lack `object_store` -- the pre-migration PB-P001
 * OCR-text sidecars -- keep their exact shape and only gain this block.
 */
function ocrQualityBlock(q: OcrQuality): string {
  return [
    'ocr_quality:',
    `  method: "${q.method}"`,
    `  language: "${q.language}"`,
    `  ratio: ${q.ratio}`,
    `  tier: "${q.tier}"`,
  ].join('\n');
}

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

async function main(): Promise<void> {
  const archiveRoot = process.env.COLONY_ARCHIVE_ROOT ?? process.argv[2];
  if (archiveRoot === undefined || archiveRoot.trim().length === 0) {
    throw new Error(
      'backfill-ocr-quality: set COLONY_ARCHIVE_ROOT (or pass the archive root as argv[2])',
    );
  }
  const runner = defaultOcrCommandRunner();
  let stamped = 0;
  let skipped = 0;

  for (const yml of walkYml(path.join(archiveRoot, 'archive'))) {
    const raw = readFileSync(yml, 'utf-8');
    if (!/(^|\n)type: "ocr-text"/.test(raw)) {
      continue;
    }
    if (/(^|\n)ocr_quality:/.test(raw)) {
      skipped += 1;
      continue;
    }
    const langMatch = raw.match(/^language: "([^"]+)"/m);
    if (langMatch === null) {
      throw new Error(`backfill-ocr-quality: no language field in ${yml}`);
    }
    const notesMatch = raw.match(/^notes:/m);
    if (notesMatch === null) {
      throw new Error(`backfill-ocr-quality: no notes anchor in ${yml}`);
    }
    const textPath = yml.replace(/\.yml$/, '');
    if (!existsSync(textPath)) {
      throw new Error(
        `backfill-ocr-quality: OCR text missing for ${yml} (expected ${textPath})`,
      );
    }
    const quality = await assessOcrQuality(
      readFileSync(textPath, 'utf-8'),
      tesseractLangFor(langMatch[1]),
      runner,
    );
    // Insert the block immediately before the top-level `notes:` line (its
    // KEY_ORDER slot: after object_store, before notes).
    const updated = raw.replace(/^notes:/m, `${ocrQualityBlock(quality)}\nnotes:`);
    writeFileSync(yml, updated);
    stamped += 1;
    console.log(
      `stamped ${quality.tier.padEnd(6)} ratio=${quality.ratio} ${quality.language}  ` +
        `${path.relative(archiveRoot, yml)}`,
    );
  }
  console.log(
    `backfill-ocr-quality: ${stamped} stamped, ${skipped} already had ocr_quality`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
