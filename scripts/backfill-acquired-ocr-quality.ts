/**
 * scripts/backfill-acquired-ocr-quality.ts
 *
 * Attach the mandatory `ocr_quality` block to SOURCE-ACQUIRED OCR-text
 * artifacts (e.g. Papers Past `source_representation: papers-past-text-tab`)
 * whose text lives in the B2 object store rather than on disk. For each
 * `type: ocr-text` companion missing `ocr_quality`, it reads the text from its
 * `local_path` when present, else pulls it from the public B2 bucket
 * (sha256-verified), computes the aspell real-word ratio for the artifact's
 * language, and inserts the `ocr_quality` block (surgical, before `notes:`).
 *
 * Usage: COLONY_ARCHIVE_ROOT=/path/to/archive tsx scripts/backfill-acquired-ocr-quality.ts
 * Idempotent: an artifact that already has `ocr_quality` is skipped.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { assessOcrQuality } from '@/ocr/quality';
import { defaultOcrCommandRunner } from '@/ocr/run';
import { publicObjectUrl, defaultHttpGet } from '@/archive/public-cache';
import { sha256OfBytes } from '@/archive/checksum';
import type { OcrQuality } from '@/archive/provenance';

const HUMAN_TO_TESSERACT: Readonly<Record<string, string>> = {
  French: 'fra',
  English: 'eng',
  Italian: 'ita',
};

function tesseractLangFor(human: string): string {
  const primary = human.split('/')[0].trim();
  const code = HUMAN_TO_TESSERACT[primary];
  if (code === undefined) {
    throw new Error(`backfill-acquired-ocr-quality: no Tesseract mapping for "${human}"`);
  }
  return code;
}

function field(raw: string, key: string): string | undefined {
  return raw.match(new RegExp(`^${key}: "([^"]*)"`, 'm'))?.[1];
}

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
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkYml(full);
    else if (entry.isFile() && entry.name.endsWith('.yml')) yield full;
  }
}

async function textBytesFor(raw: string, archiveRoot: string, yml: string): Promise<Uint8Array> {
  const localPath = field(raw, 'local_path');
  if (localPath !== undefined) {
    const abs = path.join(archiveRoot, localPath);
    if (existsSync(abs)) {
      return new Uint8Array(readFileSync(abs));
    }
  }
  // Text is in the object store: pull it from the public bucket, sha-verified.
  const key = raw.match(/^ {2}key: "([^"]+)"/m)?.[1];
  const bucket = raw.match(/^ {2}bucket: "([^"]+)"/m)?.[1];
  const endpoint = raw.match(/^ {2}endpoint: "([^"]+)"/m)?.[1];
  const provider = raw.match(/^ {2}provider: "([^"]+)"/m)?.[1];
  const sha = field(raw, 'sha256');
  if (key === undefined || bucket === undefined || endpoint === undefined || provider === undefined || sha === undefined) {
    throw new Error(`backfill-acquired-ocr-quality: no local text and no object_store for ${yml}`);
  }
  const url = publicObjectUrl({ provider, bucket, key, endpoint });
  const res = await defaultHttpGet(url);
  if (!res.ok) {
    throw new Error(`backfill-acquired-ocr-quality: GET ${url} failed (${res.status} ${res.statusText})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = sha256OfBytes(bytes);
  if (actual !== sha) {
    throw new Error(`backfill-acquired-ocr-quality: sha mismatch for ${key} (recorded ${sha}, got ${actual})`);
  }
  return bytes;
}

async function main(): Promise<void> {
  const archiveRoot = process.env.COLONY_ARCHIVE_ROOT ?? process.argv[2];
  if (archiveRoot === undefined || archiveRoot.trim().length === 0) {
    throw new Error('backfill-acquired-ocr-quality: set COLONY_ARCHIVE_ROOT (or pass argv[2])');
  }
  const runner = defaultOcrCommandRunner();
  let stamped = 0;
  let skipped = 0;

  for (const yml of walkYml(path.join(archiveRoot, 'archive'))) {
    const raw = readFileSync(yml, 'utf-8');
    if (!/(^|\n)type: "ocr-text"/.test(raw)) continue;
    if (/(^|\n)ocr_quality:/.test(raw)) { skipped += 1; continue; }
    const language = field(raw, 'language');
    if (language === undefined) throw new Error(`no language in ${yml}`);
    if (!/^notes:/m.test(raw)) throw new Error(`no notes anchor in ${yml}`);

    const bytes = await textBytesFor(raw, archiveRoot, yml);
    const quality = await assessOcrQuality(
      new TextDecoder().decode(bytes),
      tesseractLangFor(language),
      runner,
    );
    const updated = raw.replace(/^notes:/m, `${ocrQualityBlock(quality)}\nnotes:`);
    writeFileSync(yml, updated);
    stamped += 1;
    console.log(`${quality.tier.padEnd(6)} ratio=${quality.ratio} ${quality.language}  ${path.relative(archiveRoot, yml)}`);
  }
  console.log(`backfill-acquired-ocr-quality: ${stamped} stamped, ${skipped} already had ocr_quality`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
