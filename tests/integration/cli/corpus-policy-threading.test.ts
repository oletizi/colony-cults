import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runBibliography } from '@/cli/bibliography';
import { runCli } from '@/cli/dispatch';
import { runTranslateCli } from '@/cli/translate-dispatch';
import {
  composeCorpus,
  resolveCorporaRoot,
  resolveRepoRootUpward,
  type CorpusComposition,
} from '@/cli/composition-root';
import { installSourceFilenamePolicy } from '@/corpus/source-filename-bootstrap';
import type { SourceFilenamePolicy } from '@/corpus/source-filename-policy';

/**
 * AUDIT-02/16/27: THE CORPUS SEAM MUST BE WIRED ALL THE WAY THROUGH THE CLI
 * LAYER, NOT ONLY DOWN TO THE DISPATCH SITE.
 *
 * `committedSourceFilenamePolicy()` is NOT a hardcoded constant -- it unions
 * every installed manifest, and on the shipped single-corpus configuration it
 * is byte-identical to `corpus.sourceFilenames`. So the defect these cases
 * pin is not a wrong answer today; it is that six CLI wrappers and seven
 * dispatch lambdas sat ABOVE the boundary FR-018's ambient-call exception
 * covers -- the composition root had ALREADY resolved a corpus one frame up --
 * and reached for the ambient policy anyway. FR-018 authorizes the ambient
 * call only on chains that carry no composition-root parameter (`sourceKind`
 * from the fetch guardrail, `runAcquire`/`runReconcile`/`runPromote`'s plain
 * input records, the PDF batch builder); a dispatch handler is not one of
 * those.
 *
 * THE PROBE. Each case POISONS the ambient deferred composition by installing
 * a policy whose `isSourceFile` throws a sentinel, then invokes the command
 * with a REAL, valid composition. A command that still reaches for the ambient
 * policy blows up with the sentinel; a command that uses its injected
 * `corpus.sourceFilenames` never touches it and fails for its own, ordinary
 * reason instead. Every case therefore asserts the sentinel is ABSENT and that
 * the command got far enough to produce its real error.
 *
 * Each case uses a source id that exists in NO corpus, so the enumeration is
 * the only thing under test: nothing here touches the network, B2, or the
 * archive.
 */

const SENTINEL = 'SENTINEL-AMBIENT-SOURCE-FILENAME-POLICY-WAS-CONSULTED';

/** An id no committed corpus declares, so every command below fails at its own lookup. */
const UNKNOWN_SOURCE_ID = 'PB-P998';

/**
 * A policy that fails loud the instant anything enumerates through it. Installed
 * as the AMBIENT policy so that reaching for `committedSourceFilenamePolicy()`
 * is observable rather than silently equivalent to the injected one.
 */
function sentinelPolicy(): SourceFilenamePolicy {
  return {
    shapes: [{ prefix: 'SENTINEL-', padWidth: 3 }],
    isSourceFile: (): boolean => {
      throw new Error(SENTINEL);
    },
    describe: (): string => SENTINEL,
  };
}

/** The real, committed `port-breton` composition -- exactly what the composition root builds. */
function portBretonCorpus(): CorpusComposition {
  return composeCorpus({
    corporaRoot: resolveCorporaRoot(resolveRepoRootUpward()),
    cliCorpus: 'port-breton',
  });
}

describe('the CLI layer threads the injected corpus policy, never the ambient one (AUDIT-02/16/27)', () => {
  let archiveRoot: string;
  let written: string[];
  const previousArchiveRoot = process.env.COLONY_ARCHIVE_ROOT;

  beforeEach(() => {
    installSourceFilenamePolicy(sentinelPolicy());
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-policy-threading-'));
    process.env.COLONY_ARCHIVE_ROOT = archiveRoot;
    written = [];
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
      written.push(parts.map((p) => String(p)).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      written.push(parts.map((p) => String(p)).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    installSourceFilenamePolicy(null);
    if (previousArchiveRoot === undefined) {
      delete process.env.COLONY_ARCHIVE_ROOT;
    } else {
      process.env.COLONY_ARCHIVE_ROOT = previousArchiveRoot;
    }
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  /** Everything the command printed, plus (when it threw) the thrown message. */
  function output(): string {
    return written.join('\n');
  }

  describe('the four bib wrappers that sit above the FR-018 exception boundary', () => {
    it('bib verify-member uses the injected policy', async () => {
      const exitCode = await runBibliography(
        ['verify-member', UNKNOWN_SOURCE_ID],
        portBretonCorpus(),
      );

      expect(output()).not.toContain(SENTINEL);
      // Got past enumeration and failed at its own lookup instead.
      expect(output()).toMatch(/not found/i);
      expect(exitCode).toBe(1);
    });

    it('bib promote uses the injected policy', async () => {
      const exitCode = await runBibliography(
        ['promote', UNKNOWN_SOURCE_ID],
        portBretonCorpus(),
      );

      expect(output()).not.toContain(SENTINEL);
      expect(exitCode).toBe(1);
    });

    it('bib acquire uses the injected policy', async () => {
      const exitCode = await runBibliography(
        ['acquire', UNKNOWN_SOURCE_ID],
        portBretonCorpus(),
      );

      expect(output()).not.toContain(SENTINEL);
      expect(output()).toMatch(/unknown sourceId/i);
      expect(exitCode).toBe(1);
    });

    it('bib reconcile uses the injected policy', async () => {
      const exitCode = await runBibliography(
        ['reconcile', UNKNOWN_SOURCE_ID],
        portBretonCorpus(),
      );

      expect(output()).not.toContain(SENTINEL);
      expect(output()).toMatch(/unknown sourceId/i);
      expect(exitCode).toBe(1);
    });
  });

  describe('the bib dispatch handlers', () => {
    /** `runCli` with the corpus supplied hermetically, never from the developer's shell. */
    function bib(argv: string[]): Promise<number> {
      return runCli(argv, { envCorpus: 'port-breton' });
    }

    it('fetch-source uses the injected policy', async () => {
      const exitCode = await bib([
        'fetch-source',
        'ark:/12148/cb00000000x',
        '--source-id',
        UNKNOWN_SOURCE_ID,
        '--dry-run',
      ]);

      expect(output()).not.toContain(SENTINEL);
      expect(exitCode).toBe(2);
    });

    it('ocr uses the injected policy', async () => {
      const exitCode = await bib([
        'ocr',
        'ark:/12148/bpt6k0000000',
        '--source-id',
        UNKNOWN_SOURCE_ID,
        '--dry-run',
      ]);

      expect(output()).not.toContain(SENTINEL);
      expect(exitCode).toBe(2);
    });

    it('restore-images uses the injected policy', async () => {
      const exitCode = await bib([
        'restore-images',
        'ark:/12148/bpt6k0000000',
        '--source-id',
        UNKNOWN_SOURCE_ID,
        '--dry-run',
      ]);

      expect(output()).not.toContain(SENTINEL);
      expect(exitCode).toBe(2);
    });

    it('summarize uses the injected policy', async () => {
      const exitCode = await bib(['summarize', UNKNOWN_SOURCE_ID, '--dry-run']);

      expect(output()).not.toContain(SENTINEL);
      expect(exitCode).toBe(2);
    });

    it('summarize-source uses the injected policy', async () => {
      const exitCode = await bib(['summarize-source', UNKNOWN_SOURCE_ID, '--dry-run']);

      expect(output()).not.toContain(SENTINEL);
      expect(exitCode).toBe(2);
    });
  });

  describe('the translate bin dispatch handlers', () => {
    /** `runTranslateCli` throws rather than returning a code; capture the message. */
    async function translate(argv: string[]): Promise<string> {
      try {
        await runTranslateCli(argv, { envCorpus: 'port-breton' });
        return '(did not throw)';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }

    it('translate uses the injected policy', async () => {
      const message = await translate([
        'translate',
        'ark:/12148/bpt6k0000000',
        '--source-id',
        UNKNOWN_SOURCE_ID,
        '--dry-run',
      ]);

      expect(`${message}\n${output()}`).not.toContain(SENTINEL);
    });

    it('translate-source uses the injected policy', async () => {
      const message = await translate(['translate-source', UNKNOWN_SOURCE_ID, '--dry-run']);

      expect(`${message}\n${output()}`).not.toContain(SENTINEL);
    });
  });
});
