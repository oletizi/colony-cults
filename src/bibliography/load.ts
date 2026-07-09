import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { AuthoredRepositoryRecord, IdentifierLeak } from '@/bibliography/model';
import { validateRecord, validateTitle, validateWorkIdentifier } from '@/bibliography/load-fields';
import {
  assertKnownKeys,
  describeError,
  fail,
  optionalString,
  requireArray,
  requireObject,
  requireString,
} from '@/bibliography/load-primitives';
import type { Source, WorkIdentifier } from '@/model/source';

/**
 * One SSOT file's parsed contents: the hand-authored {@link Source} plus its
 * authored {@link AuthoredRepositoryRecord}s, and any {@link IdentifierLeak}s
 * found within it (misplaced-but-known identifier types -- see
 * contracts/source-record.md rule 3 and contracts/validation.md).
 */
export interface LoadedSource {
  source: Source;
  records: AuthoredRepositoryRecord[];
  identifierLeaks: IdentifierLeak[];
}

const SOURCE_ID_PATTERN = /^PB-[A-Z]?\d{3}$/;
const SOURCE_FILE_PATTERN = /^PB-[A-Z]?\d{3}\.yml$/;

const SOURCE_KEYS = new Set([
  'sourceId',
  'titles',
  'kind',
  'creator',
  'language',
  'identifiers',
  'case',
  'notes',
  'repositoryRecords',
]);

function isSourceKind(value: string): value is Source['kind'] {
  return value === 'periodical' || value === 'monograph';
}

function readFileText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`loadSourceFile(${filePath}): cannot read file: ${describeError(error)}`);
  }
}

function parseYamlOrFail(text: string, filePath: string): unknown {
  try {
    return parseYaml(text);
  } catch (error) {
    throw new Error(`loadSourceFile(${filePath}): malformed YAML: ${describeError(error)}`);
  }
}

/**
 * Parse and structurally validate one SSOT file (`bibliography/sources/PB-###.yml`)
 * into a {@link Source} and its authored {@link AuthoredRepositoryRecord}s.
 * Fails loud (throws, with a locating message) on any unreadable/malformed
 * input -- there is no fallback and nothing is silently dropped.
 *
 * See specs/004-canonical-source-metadata/contracts/source-record.md rules 1-8.
 */
export function loadSourceFile(filePath: string): LoadedSource {
  const text = readFileText(filePath);
  const parsed: unknown = parseYamlOrFail(text, filePath);
  const obj = requireObject(parsed, filePath, 'document');
  assertKnownKeys(obj, SOURCE_KEYS, filePath, 'document');

  // Rule 1: sourceId shape + filename-stem agreement.
  const sourceId = requireString(obj.sourceId, filePath, 'sourceId');
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    fail(filePath, `sourceId "${sourceId}" does not match ^PB-[A-Z]?\\d{3}$ (rule 1)`);
  }
  const stem = path.basename(filePath, path.extname(filePath));
  if (sourceId !== stem) {
    fail(filePath, `sourceId "${sourceId}" does not match filename stem "${stem}" (rule 1)`);
  }

  // Rule 2: titles.
  const titlesArr = requireArray(obj.titles, filePath, 'titles');
  if (titlesArr.length === 0) {
    fail(filePath, 'titles must have at least one entry (rule 2)');
  }
  const titles = titlesArr.map((t, i) => validateTitle(t, filePath, i));

  const kindRaw = requireString(obj.kind, filePath, 'kind');
  if (!isSourceKind(kindRaw)) {
    fail(filePath, `kind "${kindRaw}" must be "periodical" or "monograph"`);
  }

  const creator = optionalString(obj.creator, filePath, 'creator');
  const language = optionalString(obj.language, filePath, 'language');
  const sourceCase = optionalString(obj.case, filePath, 'case');
  const notes = optionalString(obj.notes, filePath, 'notes');

  // Rule 3: Source-level identifiers, work-level only. A misplaced-but-known
  // type (e.g. a copy-level `ark`) does not throw -- it is recorded as an
  // IdentifierLeak for `bib validate` to report (contract rule 3).
  const identifiers: WorkIdentifier[] = [];
  const identifierLeaks: IdentifierLeak[] = [];
  if (obj.identifiers !== undefined) {
    const results = requireArray(obj.identifiers, filePath, 'identifiers').map((v, i) =>
      validateWorkIdentifier(v, filePath, `identifiers[${i}]`),
    );
    for (const result of results) {
      if (result.kind === 'ok') {
        identifiers.push(result.identifier);
      } else {
        identifierLeaks.push({
          onLevel: 'source',
          sourceId,
          type: result.type,
          value: result.value,
          expectedLevel: result.expectedLevel,
        });
      }
    }
  }

  // Rules 4/5: each record has sourceArchive + status; (sourceId, sourceArchive) unique.
  const recordsArr =
    obj.repositoryRecords === undefined
      ? []
      : requireArray(obj.repositoryRecords, filePath, 'repositoryRecords');
  const validatedRecords = recordsArr.map((r, i) => validateRecord(r, filePath, i));
  const records = validatedRecords.map((v) => v.record);
  for (const validated of validatedRecords) {
    for (const leak of validated.identifierLeaks) {
      identifierLeaks.push({ ...leak, sourceId });
    }
  }

  const seenArchives = new Set<string>();
  for (const record of records) {
    if (seenArchives.has(record.sourceArchive)) {
      fail(
        filePath,
        `duplicate repository record for (sourceId, sourceArchive) = ` +
          `("${sourceId}", "${record.sourceArchive}") (rule 5)`,
      );
    }
    seenArchives.add(record.sourceArchive);
  }

  const source: Source = {
    sourceId,
    titles,
    kind: kindRaw,
    identifiers,
    creator,
    language,
    case: sourceCase,
    notes,
  };

  return { source, records, identifierLeaks };
}

function readSourceDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (error) {
    throw new Error(`loadAllSources(${dir}): cannot read directory: ${describeError(error)}`);
  }
}

/**
 * Read every `bibliography/sources/PB-*.yml` SSOT file in `dir`, in
 * deterministic (sorted) filename order.
 */
export function loadAllSources(dir: string): LoadedSource[] {
  const names = readSourceDir(dir)
    .filter((name) => SOURCE_FILE_PATTERN.test(name))
    .sort();
  return names.map((name) => loadSourceFile(path.join(dir, name)));
}
