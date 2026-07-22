import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import {
  readSummaryRef,
  validateSummaryRef,
  writeSummaryRef,
} from '@/bibliography/summary-reference';
import type { Source } from '@/model/source';

/**
 * Spec 017 (T025-T027): the bibliography REFERENCE to the thorough summary --
 * a by-path pointer (`census:`-style) on the Source record pointing at the
 * source-level rollup thorough summary (`source.summary.long.en.md`).
 *
 * The exhaustive prose is NEVER inlined into the structured SSOT (FR-007,
 * SC-005); the record holds ONLY the archive-relative path string. A light
 * validation asserts the ref resolves to an existing artifact on disk (Decision
 * 5) and fails loud on a dangling ref -- deliberately WITHOUT reusing the
 * B2-key-prefix companion validator (it points at git-resident markdown,
 * `object_store: null`, not a B2-direct object key).
 */

// A realistic archive-relative rollup path (mirrors the census: idiom shape).
const ROLLUP_REF =
  'archive/cases/port-breton/newspapers/la-nouvelle-france/source.summary.long.en.md';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'summary-reference-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseSource(sourceId: string): Source {
  return {
    sourceId,
    kind: 'periodical',
    case: 'port-breton',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
  };
}

describe('summaryRef bibliography reference (T025-T027)', () => {
  it('(a) round-trips a summaryRef path through serialize -> load, losslessly and idempotently', () => {
    const source = writeSummaryRef(baseSource('PB-P901'), ROLLUP_REF);
    expect(readSummaryRef(source)).toBe(ROLLUP_REF);

    const serialized = serializeSource({ source, records: [] });
    const filePath = path.join(dir, 'PB-P901.yml');
    writeFileSync(filePath, serialized, 'utf-8');

    const loaded = loadSourceFile(filePath).source;
    expect(loaded.summaryRef).toBe(ROLLUP_REF);
    expect(readSummaryRef(loaded)).toBe(ROLLUP_REF);

    // Idempotent: re-serializing the reloaded source is byte-identical.
    const reserialized = serializeSource({ source: loaded, records: [] });
    expect(reserialized).toBe(serialized);
  });

  it('(a2) a source WITHOUT a summaryRef omits the key entirely (byte-identical to a plain record)', () => {
    const source = baseSource('PB-P902');
    const serialized = serializeSource({ source, records: [] });
    expect(serialized).not.toMatch(/summaryRef/);

    const filePath = path.join(dir, 'PB-P902.yml');
    writeFileSync(filePath, serialized, 'utf-8');
    const loaded = loadSourceFile(filePath).source;
    expect(loaded.summaryRef).toBeUndefined();
    expect(readSummaryRef(loaded)).toBeUndefined();

    const reserialized = serializeSource({ source: loaded, records: [] });
    expect(reserialized).toBe(serialized);
  });

  it('(b) writes ONLY the path string -- no inlined prose in the YAML (SC-005)', () => {
    const source = writeSummaryRef(baseSource('PB-P903'), ROLLUP_REF);
    const serialized = serializeSource({ source, records: [] });

    // The path appears verbatim, on a SINGLE line (a scalar pointer, not a
    // multi-line block-scalar of prose).
    expect(serialized).toMatch(/^summaryRef: .*source\.summary\.long\.en\.md$/m);
    // No YAML block-scalar indicator (| or >) attached to summaryRef -- which
    // is how inlined multi-line prose would be encoded.
    expect(serialized).not.toMatch(/summaryRef:\s*[|>]/);

    // Round-trips as a plain string, never an object/prose structure.
    const filePath = path.join(dir, 'PB-P903.yml');
    writeFileSync(filePath, serialized, 'utf-8');
    const loaded = loadSourceFile(filePath).source;
    expect(typeof loaded.summaryRef).toBe('string');
  });

  it('(c) validation reports OK (returns the resolved path) when the summaryRef resolves on disk', () => {
    const archiveRoot = mkdtempSync(path.join(tmpdir(), 'summary-ref-archive-'));
    try {
      const artifactPath = path.join(archiveRoot, ROLLUP_REF);
      mkdirSync(path.dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, '---\ntopics: []\n---\nRollup prose.\n', 'utf-8');

      const source = writeSummaryRef(baseSource('PB-P904'), ROLLUP_REF);
      const resolved = validateSummaryRef(source, archiveRoot);
      expect(resolved).toBe(artifactPath);
      expect(existsSync(resolved as string)).toBe(true);
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it('(c2) validation fails loud when the summaryRef dangles (no artifact on disk)', () => {
    const archiveRoot = mkdtempSync(path.join(tmpdir(), 'summary-ref-archive-'));
    try {
      const source = writeSummaryRef(baseSource('PB-P905'), ROLLUP_REF);
      expect(() => validateSummaryRef(source, archiveRoot)).toThrow(/dangling|does not resolve/i);
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it('(c3) validation is a no-op (returns undefined) for a source with no summaryRef', () => {
    const archiveRoot = mkdtempSync(path.join(tmpdir(), 'summary-ref-archive-'));
    try {
      const source = baseSource('PB-P906');
      expect(validateSummaryRef(source, archiveRoot)).toBeUndefined();
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it('(d) writeSummaryRef rejects an empty or absolute path (fail loud)', () => {
    expect(() => writeSummaryRef(baseSource('PB-P907'), '   ')).toThrow(/non-empty/i);
    expect(() => writeSummaryRef(baseSource('PB-P908'), '/abs/rollup.md')).toThrow(
      /archive-relative|absolute/i,
    );
  });

  // AUDIT-20260722-15/-12: validateSummaryRef must reject a summaryRef that
  // escapes archiveRoot via ".." traversal or an absolute path, even though
  // it reached this function having bypassed writeSummaryRef entirely (e.g.
  // authored directly in YAML -- `loadSourceFile`'s `optionalString` performs
  // no path validation).
  it('(e) validation rejects a summaryRef containing ".." traversal segments (fail loud)', () => {
    const archiveRoot = mkdtempSync(path.join(tmpdir(), 'summary-ref-archive-'));
    try {
      // Plant a real file just outside archiveRoot, so a naive join+existsSync
      // check (no in-root guard) would otherwise succeed.
      const outsidePath = path.join(archiveRoot, '..', 'escaped-secret.md');
      writeFileSync(outsidePath, 'not part of the archive', 'utf-8');
      try {
        const source = writeSummaryRef(baseSource('PB-P909'), '../escaped-secret.md');
        expect(() => validateSummaryRef(source, archiveRoot)).toThrow(
          /\.\.|traversal|outside|absolute/i,
        );
      } finally {
        rmSync(outsidePath, { force: true });
      }
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it('(f) validation rejects an absolute summaryRef even when it targets a real file (fail loud)', () => {
    const archiveRoot = mkdtempSync(path.join(tmpdir(), 'summary-ref-archive-'));
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'summary-ref-outside-'));
    try {
      const absoluteTarget = path.join(outsideDir, 'abs-target.md');
      writeFileSync(absoluteTarget, 'not part of the archive', 'utf-8');

      // writeSummaryRef already refuses to author an absolute ref -- construct
      // the Source directly to model a ref that reached validateSummaryRef by
      // some other path (e.g. hand-authored YAML), the same defense-in-depth
      // scenario the docstring calls out.
      const source: Source = { ...baseSource('PB-P910'), summaryRef: absoluteTarget };
      expect(() => validateSummaryRef(source, archiveRoot)).toThrow(/absolute|outside/i);
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  // AUDIT-20260722-14: validateSummaryRef must be reachable through the REAL
  // load path (`loadSourceFile`'s validating mode), not just callable as a
  // standalone helper -- this is the invocation `bib validate` actually uses
  // (`@/cli/bibliography`'s `runValidate`).
  describe('wired enforcement via loadSourceFile (AUDIT-20260722-14)', () => {
    it('(g) loadSourceFile WITHOUT archiveRoot loads a dangling summaryRef silently (documents pre-fix, non-validating default)', () => {
      const source = writeSummaryRef(baseSource('PB-P911'), ROLLUP_REF);
      const serialized = serializeSource({ source, records: [] });
      const filePath = path.join(dir, 'PB-P911.yml');
      writeFileSync(filePath, serialized, 'utf-8');

      // No archiveRoot supplied -- the default, non-validating mode every
      // pre-existing caller (PDF rendering, acquisition, etc.) relies on.
      const loaded = loadSourceFile(filePath).source;
      expect(loaded.summaryRef).toBe(ROLLUP_REF);
    });

    it('(h) loadSourceFile WITH archiveRoot rejects a dangling summaryRef (fail loud, wired path)', () => {
      const archiveRoot = mkdtempSync(path.join(tmpdir(), 'summary-ref-archive-'));
      try {
        const source = writeSummaryRef(baseSource('PB-P912'), ROLLUP_REF);
        const serialized = serializeSource({ source, records: [] });
        const filePath = path.join(dir, 'PB-P912.yml');
        writeFileSync(filePath, serialized, 'utf-8');

        // The artifact was never generated under archiveRoot -- the exact
        // "renamed/moved/never generated" scenario AUDIT-20260722-14 names.
        expect(() => loadSourceFile(filePath, archiveRoot)).toThrow(
          /loadSourceFile.*dangling|does not resolve/i,
        );
      } finally {
        rmSync(archiveRoot, { recursive: true, force: true });
      }
    });

    it('(i) loadSourceFile WITH archiveRoot accepts a resolvable summaryRef (no regression)', () => {
      const archiveRoot = mkdtempSync(path.join(tmpdir(), 'summary-ref-archive-'));
      try {
        const artifactPath = path.join(archiveRoot, ROLLUP_REF);
        mkdirSync(path.dirname(artifactPath), { recursive: true });
        writeFileSync(artifactPath, '---\ntopics: []\n---\nRollup prose.\n', 'utf-8');

        const source = writeSummaryRef(baseSource('PB-P913'), ROLLUP_REF);
        const serialized = serializeSource({ source, records: [] });
        const filePath = path.join(dir, 'PB-P913.yml');
        writeFileSync(filePath, serialized, 'utf-8');

        const loaded = loadSourceFile(filePath, archiveRoot).source;
        expect(loaded.summaryRef).toBe(ROLLUP_REF);
      } finally {
        rmSync(archiveRoot, { recursive: true, force: true });
      }
    });

    it('(j) loadSourceFile WITH archiveRoot rejects a traversal summaryRef authored directly in YAML (fail loud, wired path)', () => {
      const archiveRoot = mkdtempSync(path.join(tmpdir(), 'summary-ref-archive-'));
      try {
        // Author the SSOT file directly (bypassing writeSummaryRef's own
        // absolute-path rejection) to model a hand-edited/maliciously-crafted
        // summaryRef reaching the loader, per AUDIT-20260722-15/-12.
        const filePath = path.join(dir, 'PB-P914.yml');
        writeFileSync(
          filePath,
          [
            'sourceId: PB-P914',
            'kind: periodical',
            'titles:',
            '  - text: La Nouvelle France',
            '    role: canonical',
            'summaryRef: ../escaped-secret.md',
          ].join('\n') + '\n',
          'utf-8',
        );

        expect(() => loadSourceFile(filePath, archiveRoot)).toThrow(
          /loadSourceFile.*(traversal|outside|absolute)/i,
        );
      } finally {
        rmSync(archiveRoot, { recursive: true, force: true });
      }
    });
  });
});
