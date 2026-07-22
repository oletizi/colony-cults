import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  serializeProvenance,
  parseProvenance,
  readProvenance,
  writeProvenance,
  type ProvenanceFields,
} from '@/archive/provenance';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(here, '../../fixtures/page-provenance.yml');

/**
 * An OCR/translation-style record that predates the summary keys: it carries
 * the machine-assistance fields (engine/model/translation) and an ocr_quality
 * block, but NONE of the new summary fields. It stands in for every existing
 * non-summary record that MUST re-serialize byte-identically after the T005
 * extension (the additive-optional no-regression guarantee).
 */
function ocrTranslationFields(): ProvenanceFields {
  return {
    id: 'PB-P061',
    title: 'La Nouvelle France',
    type: 'english-translation',
    case: 'port-breton',
    language: 'English',
    source_archive: 'Papers Past',
    catalog_url: 'https://example.org/issue',
    original_url: 'https://example.org/issue/text',
    rights_status: 'public-domain',
    retrieved: '2026-07-08T00:00:00.000Z',
    local_path: 'archive/papers-past/hns/issue.en.txt',
    sha256: 'a'.repeat(64),
    size: 4096,
    format: 'text/plain',
    ocr_status: 'searchable',
    engine: 'claude-code-cli',
    model: 'claude-opus-4',
    translation: 'machine-assisted',
    object_store: null,
    ocr_quality: {
      method: 'aspell-realword-ratio-v1',
      language: 'en',
      ratio: 0.46,
      tier: 'low',
    },
    rights_raw: '<results/>',
    notes: null,
  };
}

/** A summary sidecar record carrying every new additive-optional field. */
function summaryFields(): ProvenanceFields {
  return {
    id: 'PB-P061',
    title: 'La Nouvelle France',
    type: 'summary-thorough',
    case: 'port-breton',
    language: 'English',
    source_archive: 'Papers Past',
    catalog_url: 'https://example.org/issue',
    original_url: 'https://example.org/issue/text',
    rights_status: 'public-domain',
    retrieved: '2026-07-21',
    local_path: 'archive/papers-past/hns/issue.summary.long.en.md',
    sha256: 'b'.repeat(64),
    size: 812,
    format: 'text/markdown',
    ocr_status: 'none',
    engine: 'claude-code-cli',
    model: 'claude-sonnet-5',
    interpretation: 'machine-generated-summary',
    input_layers: [
      { path: 'issue.txt', sha256: 'c'.repeat(64) },
      { path: 'issue.en.txt', sha256: 'd'.repeat(64) },
    ],
    input_quality: {
      tier: 'low',
      note: 'source OCR low-confidence; summary may inherit errors',
    },
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
  };
}

/**
 * A SOURCE-ROLLUP sidecar record carrying the machine-readable coverage lists
 * (AUDIT-20260722-09): `covered_issues` non-empty, `missing_issues` present but
 * possibly empty. Stands in for the canonical coverage contract downstream
 * audit/browser/indexing code reads via `readProvenance`.
 */
function rollupFields(): ProvenanceFields {
  return {
    ...summaryFields(),
    local_path: 'archive/papers-past/hns/source.summary.long.en.md',
    covered_issues: ['bpt6k5603637g', 'bpt6k5603638h'],
    missing_issues: ['bpt6k5603639i'],
  };
}

describe('rollup coverage sidecar (covered_issues / missing_issues)', () => {
  it('emits both lists as deterministic block sequences of quoted arks', () => {
    const yaml = serializeProvenance(rollupFields());
    expect(yaml).toContain('covered_issues:');
    expect(yaml).toContain('  - "bpt6k5603637g"');
    expect(yaml).toContain('  - "bpt6k5603638h"');
    expect(yaml).toContain('missing_issues:');
    expect(yaml).toContain('  - "bpt6k5603639i"');
  });

  it('places covered_issues/missing_issues after input_quality and before object_store', () => {
    const yaml = serializeProvenance(rollupFields());
    const topKeys = yaml
      .trimEnd()
      .split('\n')
      .filter((line) => !/^\s/.test(line))
      .map((line) => line.slice(0, line.indexOf(':')));
    const idx = (k: string): number => topKeys.indexOf(k);
    expect(idx('covered_issues')).toBe(idx('input_quality') + 1);
    expect(idx('missing_issues')).toBe(idx('covered_issues') + 1);
    expect(idx('object_store')).toBeGreaterThan(idx('missing_issues'));
  });

  it('round-trips the rollup record (serialize -> parse -> serialize stable)', () => {
    const fields = rollupFields();
    const yaml = serializeProvenance(fields);
    const parsed = parseProvenance(yaml);
    expect(parsed).toEqual(fields);
    expect(serializeProvenance(parsed)).toBe(yaml);
  });

  it('emits an empty missing_issues as `missing_issues: []` and round-trips it to []', () => {
    const fields: ProvenanceFields = { ...rollupFields(), missing_issues: [] };
    const yaml = serializeProvenance(fields);
    expect(yaml).toContain('missing_issues: []');
    const parsed = parseProvenance(yaml);
    expect(parsed.missing_issues).toEqual([]);
    expect(serializeProvenance(parsed)).toBe(yaml);
  });

  it('(round-trip via disk) readProvenance recovers the coverage lists a rollup sidecar wrote', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cc-rollup-prov-'));
    try {
      const yamlPath = path.join(dir, 'source.summary.long.en.md.yml');
      const fields = rollupFields();
      await writeProvenance(yamlPath, fields);
      const recovered = await readProvenance(yamlPath);
      expect(recovered.covered_issues).toEqual(['bpt6k5603637g', 'bpt6k5603638h']);
      expect(recovered.missing_issues).toEqual(['bpt6k5603639i']);
      // Full structural round-trip through the filesystem.
      expect(recovered).toEqual(fields);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits both keys entirely on a non-rollup record (issue sidecar byte-identity)', () => {
    const yaml = serializeProvenance(summaryFields());
    expect(yaml).not.toMatch(/^covered_issues:/m);
    expect(yaml).not.toMatch(/^missing_issues:/m);
    const parsed = parseProvenance(yaml);
    expect(parsed.covered_issues).toBeUndefined();
    expect(parsed.missing_issues).toBeUndefined();
  });
});

describe('input_layers origin attribution (FR-021)', () => {
  /** A Papers Past summary sidecar: one source-downloaded OCR layer, attributed. */
  function papersPastSummaryFields(): ProvenanceFields {
    return {
      ...summaryFields(),
      input_layers: [
        {
          path: 'archive/papers-past/esd18800401.2.28/abc.txt',
          sha256: 'e'.repeat(64),
          origin: 'papers-past-ocr',
          source_representation: 'papers-past-text-tab',
        },
      ],
    };
  }

  it('emits origin + source_representation as four-space-indented sub-keys after sha256', () => {
    const yaml = serializeProvenance(papersPastSummaryFields());
    expect(yaml).toContain('  - path: "archive/papers-past/esd18800401.2.28/abc.txt"');
    expect(yaml).toContain(`    sha256: "${'e'.repeat(64)}"`);
    expect(yaml).toContain('    origin: "papers-past-ocr"');
    expect(yaml).toContain('    source_representation: "papers-past-text-tab"');
  });

  it('round-trips a record whose input_layers carry origin/source_representation', () => {
    const fields = papersPastSummaryFields();
    const yaml = serializeProvenance(fields);
    const parsed = parseProvenance(yaml);
    expect(parsed).toEqual(fields);
    expect(serializeProvenance(parsed)).toBe(yaml);
  });

  it('round-trips project-ocr + project-translation origins in order', () => {
    const fields: ProvenanceFields = {
      ...summaryFields(),
      input_layers: [
        { path: 'issue.txt', sha256: 'c'.repeat(64), origin: 'project-ocr' },
        { path: 'issue.en.txt', sha256: 'd'.repeat(64), origin: 'project-translation' },
      ],
    };
    const yaml = serializeProvenance(fields);
    expect(yaml).toContain('    origin: "project-ocr"');
    expect(yaml).toContain('    origin: "project-translation"');
    expect(parseProvenance(yaml)).toEqual(fields);
  });

  it('rejects an unknown input_layers origin (fail loud)', () => {
    const yaml = serializeProvenance(summaryFields()).replace(
      `    sha256: "${'c'.repeat(64)}"`,
      `    sha256: "${'c'.repeat(64)}"\n    origin: "not-a-real-origin"`,
    );
    expect(() => parseProvenance(yaml)).toThrow(/origin/);
  });

  it('a layer WITHOUT origin re-serializes to the pre-FR-021 two-line shape (byte-identity)', () => {
    // summaryFields()'s input_layers carry no origin -> the emitted item is
    // still exactly `- path:` + `sha256:` with no extra sub-keys.
    const yaml = serializeProvenance(summaryFields());
    expect(yaml).not.toContain('    origin:');
    expect(serializeProvenance(parseProvenance(yaml))).toBe(yaml);
  });
});

describe('summary provenance sidecar (additive-optional fields)', () => {
  it('(a) round-trips a record WITH the summary fields (serialize -> parse -> serialize stable)', () => {
    const fields = summaryFields();
    const yaml = serializeProvenance(fields);

    // The interpretation label is emitted as a quoted scalar.
    expect(yaml).toContain('interpretation: "machine-generated-summary"');
    // input_layers is a YAML sequence of {path, sha256} mappings.
    expect(yaml).toContain('input_layers:');
    expect(yaml).toContain('  - path: "issue.txt"');
    expect(yaml).toContain(`    sha256: "${'c'.repeat(64)}"`);
    expect(yaml).toContain('  - path: "issue.en.txt"');
    expect(yaml).toContain(`    sha256: "${'d'.repeat(64)}"`);
    // input_quality is a nested block; tier from the closed set, note free text.
    expect(yaml).toContain('input_quality:');
    expect(yaml).toContain('  tier: "low"');
    expect(yaml).toContain(
      '  note: "source OCR low-confidence; summary may inherit errors"',
    );

    // Full structural round-trip.
    const parsed = parseProvenance(yaml);
    expect(parsed).toEqual(fields);

    // Re-serialization is byte-stable across the round trip.
    expect(serializeProvenance(parsed)).toBe(yaml);
  });

  it('(a) places the summary keys after source_representation and before object_store', () => {
    const yaml = serializeProvenance(summaryFields());
    const topKeys = yaml
      .trimEnd()
      .split('\n')
      .filter((line) => !/^\s/.test(line))
      .map((line) => line.slice(0, line.indexOf(':')));

    const idx = (k: string): number => topKeys.indexOf(k);
    expect(idx('interpretation')).toBeGreaterThan(idx('ocr_status'));
    expect(idx('input_layers')).toBe(idx('interpretation') + 1);
    expect(idx('input_quality')).toBe(idx('input_layers') + 1);
    expect(idx('object_store')).toBeGreaterThan(idx('input_quality'));
  });

  it('(b) omits every summary key entirely when unset (OCR/translation record unaffected)', () => {
    const yaml = serializeProvenance(ocrTranslationFields());
    expect(yaml).not.toMatch(/^interpretation:/m);
    expect(yaml).not.toMatch(/^input_layers:/m);
    expect(yaml).not.toMatch(/^input_quality:/m);

    const parsed = parseProvenance(yaml);
    expect(parsed.interpretation).toBeUndefined();
    expect(parsed.input_layers).toBeUndefined();
    expect(parsed.input_quality).toBeUndefined();
  });

  it('(b) re-serializes an OCR/translation record byte-identically after the extension', () => {
    const fields = ocrTranslationFields();
    const once = serializeProvenance(fields);
    // parse then re-serialize yields the exact same bytes (no drift from the
    // additive summary keys).
    expect(serializeProvenance(parseProvenance(once))).toBe(once);
  });

  it('(b) re-serializes the committed on-disk fixture byte-identically', () => {
    // The committed fixture predates ALL machine-assistance/summary keys.
    // Parsing then re-serializing MUST reproduce the exact bytes on disk.
    const original = readFileSync(FIXTURE_PATH, 'utf-8');
    expect(serializeProvenance(parseProvenance(original))).toBe(original);
  });
});
