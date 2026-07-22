/**
 * Crash-safety / write-order regression tests for `materializeIssueText`
 * (AUDIT-BARRAGE finding, spec 017 govern pass) -- split out from the main
 * `issue-text-materialize.test.ts` (T1-T6) so each file stays under the
 * project's 500-line guideline; this file needs a file-scoped
 * `vi.mock('node:fs/promises', ...)` those tests do not.
 *
 * The fresh-materialization path used to write `issue.txt` FIRST and the
 * `issue.txt.yml` provenance sidecar SECOND. A crash between the two writes
 * left a bare `issue.txt` with no sidecar -- which the module's own
 * FR-004/FR-005 discriminator (sidecar presence) then permanently
 * misclassified as a foreign/inline file (FR-005's no-op branch), silently
 * serving the partial/stale generated text forever, with no checksum
 * re-verification.
 *
 * The fix reorders the writes (sidecar FIRST, `issue.txt` SECOND, the latter
 * written atomically via temp-file + rename) so the only reachable crash
 * residue is "sidecar present, `issue.txt` absent" -- which the existing
 * `existing === undefined` fresh-path check already classifies correctly
 * (re-materialize, never foreign). See `@/archive/issue-text-materialize`'s
 * module doc "CRASH-SAFETY" note.
 *
 *  - T7 proves the classification is SAFE given that crash residue.
 *  - T8 proves the module actually PRODUCES only that residue (sidecar
 *    always written before the atomic `issue.txt` rename), by observing the
 *    real order of `node:fs/promises` calls.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

import type { Source } from '@/model/source';
import type { RepositoryRecord } from '@/model/repository-record';
import { writeMemberFixture } from './member-fixture';
import { materializeIssueText } from '@/archive/issue-text-materialize';

/** A Source with its repositoryRecords, as expected by materializeIssueText. */
type SourceWithRecords = Source & { repositoryRecords: RepositoryRecord[] };

/**
 * Records every `writeFile`/`rename` call `node:fs/promises` sees for the
 * lifetime of this test file, as `"writeFile:<path>"`/`"rename:<newPath>"`
 * strings -- used ONLY by T8, which filters this array down to the entries
 * touching ITS OWN member directory (a unique `sourceId`/`slug`) so other
 * tests' fixture writes never pollute its assertion. `vi.mock` is
 * file-scoped and hoisted, so this instruments every `node:fs/promises` call
 * any code under test makes for every test in this file -- harmless for T7
 * (the wrapper delegates to the real implementation unconditionally; only
 * the event log is new behavior).
 */
const fsPromisesEvents: string[] = [];

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      fsPromisesEvents.push(`writeFile:${String(args[0])}`);
      return actual.writeFile(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      fsPromisesEvents.push(`rename:${String(args[1])}`);
      return actual.rename(...args);
    },
  };
});

describe('materializeIssueText crash-safety (AUDIT-BARRAGE FINDING 2)', () => {
  it('recovers safely from a simulated crash window (sidecar present, issue.txt absent): re-materializes fresh rather than misclassifying as foreign (T7)', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G901',
      sourceId: 'PB-P908',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-22',
      pageCount: 2,
      articleDate: '1879-07-22',
      ocrText: 'Recovered OCR text after a simulated crash between the two writes.',
    });

    try {
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      // Simulate the crash window: pre-create the member dir with a STALE
      // sidecar (bogus provenance, as if written just before the crash) but
      // NO issue.txt at all -- the exact state a crash between the (now
      // sidecar-first) writeSidecar call and the issue.txt rename would leave
      // behind. If the write order were reversed (issue.txt first), THIS
      // state would instead be unreachable and "issue.txt present, no
      // sidecar" would be the crash residue -- misclassified as foreign.
      await mkdir(fixture.sourceDir, { recursive: true });
      const sidecarPath = path.join(fixture.sourceDir, 'issue.txt.yml');
      const issueTxtPath = path.join(fixture.sourceDir, 'issue.txt');
      await writeFile(
        sidecarPath,
        'id: STALE\nobject_store:\n  key: bogus-stale-key\nsha256: deadbeefdeadbeef\n',
        'utf-8',
      );

      // Precondition: issue.txt genuinely does not exist yet.
      await expect(readFile(issueTxtPath, 'utf-8')).rejects.toThrow(/ENOENT/);

      // materializeIssueText must NOT throw, and must NOT treat the stale
      // sidecar-without-issue.txt state as a conflict or as foreign -- it
      // must re-materialize fresh.
      const resultPath = await materializeIssueText(
        memberWithRecords,
        fixture.archiveRoot,
        fixture.objectStore,
      );
      expect(resultPath).toBe(issueTxtPath);

      // issue.txt now exists with the CORRECT (freshly fetched) content, not
      // some artifact of the stale sidecar.
      const content = await readFile(issueTxtPath, 'utf-8');
      expect(content).toBe(
        'Recovered OCR text after a simulated crash between the two writes.',
      );

      // The sidecar was overwritten with CORRECT provenance (not left stale).
      const sidecarRaw = await readFile(sidecarPath, 'utf-8');
      const sidecarData = parseYaml(sidecarRaw) as Record<string, unknown>;
      expect(sidecarData.sha256).toBe(fixture.ocrTextSha256);
      expect((sidecarData.object_store as Record<string, unknown>).key).toBe(
        fixture.ocrTextObjectStoreKey,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('writes the sidecar BEFORE issue.txt (atomically, via temp-file + rename) on a fresh materialize (T8)', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G901',
      sourceId: 'PB-P909',
      case: 'port-breton',
      slug: 'la-nouvelle-france-1879-07-23-write-order',
      pageCount: 1,
      articleDate: '1879-07-23',
      ocrText: 'Write-order regression fixture text.',
    });

    try {
      const memberWithRecords: SourceWithRecords = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      const eventsBefore = fsPromisesEvents.length;
      await materializeIssueText(memberWithRecords, fixture.archiveRoot, fixture.objectStore);
      const events = fsPromisesEvents.slice(eventsBefore);

      // The sidecar is written via a direct `writeFile` at its own path.
      const sidecarWriteIdx = events.findIndex(
        (e) => e.startsWith('writeFile:') && e.endsWith('issue.txt.yml'),
      );
      // `issue.txt` itself is written atomically: a `writeFile` to a *.tmp
      // sibling, then a `rename` whose destination is `issue.txt` itself.
      const issueTxtRenameIdx = events.findIndex(
        (e) => e.startsWith('rename:') && e.endsWith(path.sep + 'issue.txt'),
      );

      expect(sidecarWriteIdx).toBeGreaterThanOrEqual(0);
      expect(issueTxtRenameIdx).toBeGreaterThanOrEqual(0);
      expect(sidecarWriteIdx).toBeLessThan(issueTxtRenameIdx);

      // Sanity: no direct (non-atomic) `writeFile` straight to `issue.txt`
      // ever occurs -- it is ALWAYS written via a temp file + rename.
      const directIssueTxtWriteIdx = events.findIndex(
        (e) => e.startsWith('writeFile:') && e.endsWith(path.sep + 'issue.txt'),
      );
      expect(directIssueTxtWriteIdx).toBe(-1);
    } finally {
      fixture.cleanup();
    }
  });
});
