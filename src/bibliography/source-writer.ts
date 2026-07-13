import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { MigratedSource } from '@/bibliography/migrate-serialize';
import { serializeSource } from '@/bibliography/migrate-serialize';

/**
 * Write one {@link MigratedSource} to `<dir>/<sourceId>.yml` using the same
 * deterministic serialization `migrate.ts` writes inline (see
 * `serializeSource`). Does not create `dir` -- callers that need the
 * directory to exist first should `mkdirSync(dir, { recursive: true })`
 * (mirroring migrate.ts's own behavior).
 *
 * Fails loud rather than writing to a malformed path: an empty/whitespace
 * `sourceId` would produce a nonsensical `<dir>/.yml` file, which is worse
 * than an error naming the missing data.
 */
export function writeSourceFile(dir: string, migrated: MigratedSource): string {
  const sourceId = migrated.source.sourceId;
  if (sourceId.trim().length === 0) {
    throw new Error(
      'writeSourceFile: migrated.source.sourceId is empty -- refusing to write to a malformed path',
    );
  }
  const filePath = path.join(dir, `${sourceId}.yml`);
  writeFileSync(filePath, serializeSource(migrated), 'utf-8');
  return filePath;
}
