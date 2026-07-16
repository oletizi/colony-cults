import { describe, it, expect, vi, afterEach } from 'vitest';

import { parseInventoryArgs, runInventoryCli } from '@/cli/bib-inventory';

/**
 * Tests for `bib inventory`'s CLI wiring (T017, specs/011-museum-
 * acquisition-path): the pure `--repository` flag parsing/narrowing, and the
 * synchronous fail-loud branches of `runInventoryCli` that return before any
 * network/engine call (so they are safely unit-testable). The FULL
 * network-backed Gallica and engine-backed museum paths are exercised at the
 * `runInventory` / `runMuseumInventory` level (`@/sourcegroup/inventory.test`,
 * `@/sourcegroup/museum-inventory.test`), mirroring how sibling CLI verbs in
 * `@/cli/bib-sourcegroup` are tested (`parseAcquireArgs`/`parseReconcileArgs`,
 * not the full `run*Cli`).
 */

describe('parseInventoryArgs', () => {
  it('parses a bare Gallica-path invocation with no --repository', () => {
    const parsed = parseInventoryArgs(['ark:/12148/bpt6k1234567', '--group', 'PB-S001']);
    expect(parsed.locator).toBe('ark:/12148/bpt6k1234567');
    expect(parsed.group).toBe('PB-S001');
    expect(parsed.repository).toBeUndefined();
    expect(parsed.kindRaw).toBeUndefined();
    expect(parsed.archive).toBeUndefined();
    expect(parsed.dryRun).toBe(false);
  });

  it('parses --repository new-italy-museum', () => {
    const parsed = parseInventoryArgs([
      'https://newitaly.org.au/CAT/000844.htm',
      '--group',
      'PB-S006',
      '--repository',
      'new-italy-museum',
    ]);
    expect(parsed.repository).toBe('new-italy-museum');
    expect(parsed.locator).toBe('https://newitaly.org.au/CAT/000844.htm');
  });

  it('parses an explicit --repository gallica the same as absent', () => {
    const parsed = parseInventoryArgs([
      'ark:/12148/bpt6k1234567',
      '--group',
      'PB-S001',
      '--repository',
      'gallica',
    ]);
    expect(parsed.repository).toBe('gallica');
  });

  it('parses --kind, --archive, and --dry-run', () => {
    const parsed = parseInventoryArgs([
      'ark:/12148/bpt6k1234567',
      '--group',
      'PB-S001',
      '--kind',
      'periodical',
      '--archive',
      'State Library of Queensland',
      '--dry-run',
    ]);
    expect(parsed.kindRaw).toBe('periodical');
    expect(parsed.archive).toBe('State Library of Queensland');
    expect(parsed.dryRun).toBe(true);
  });

  it('parses --repository internet-archive', () => {
    const parsed = parseInventoryArgs([
      'nouvellefrancec00groogoog',
      '--group',
      'PB-S006',
      '--repository',
      'internet-archive',
    ]);
    expect(parsed.repository).toBe('internet-archive');
    expect(parsed.locator).toBe('nouvellefrancec00groogoog');
  });

  it('throws (fail loud) on an unknown --repository name', () => {
    expect(() =>
      parseInventoryArgs([
        'https://example.org/item/1',
        '--group',
        'PB-S006',
        '--repository',
        'not-a-real-repository',
      ]),
    ).toThrow(/--repository must be "gallica", "new-italy-museum", or "internet-archive"/);
  });
});

describe('runInventoryCli (synchronous fail-loud branches)', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    errorSpy.mockClear();
  });

  it('returns exit code 2 and prints a message when the locator is missing', async () => {
    const code = await runInventoryCli(['--group', 'PB-S001']);
    expect(code).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing required argument <locator>'),
    );
  });

  it('returns exit code 2 when --group is missing', async () => {
    const code = await runInventoryCli(['ark:/12148/bpt6k1234567']);
    expect(code).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('missing required flag --group'));
  });

  it('returns exit code 2 on an unknown --repository (parse-time fail loud)', async () => {
    const code = await runInventoryCli([
      'https://example.org/item/1',
      '--group',
      'PB-S006',
      '--repository',
      'not-a-real-repository',
    ]);
    expect(code).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '--repository must be "gallica", "new-italy-museum", or "internet-archive"',
      ),
    );
  });

  it(
    'returns exit code 2 when --kind is given but does not match "archival-item" for ' +
      '--repository internet-archive, WITHOUT ever constructing the IA adapter (no network)',
    async () => {
      const code = await runInventoryCli([
        'nouvellefrancec00groogoog',
        '--group',
        'PB-S006',
        '--repository',
        'internet-archive',
        '--kind',
        'monograph',
      ]);
      expect(code).toBe(2);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('--kind must be "archival-item" for --repository "internet-archive"'),
      );
    },
  );

  it(
    'returns exit code 2 when --kind is given but does not match "archival-item" for a museum ' +
      '--repository, WITHOUT ever constructing the engine-backed extractor',
    async () => {
      const code = await runInventoryCli([
        'https://example.org/item/1',
        '--group',
        'PB-S006',
        '--repository',
        'new-italy-museum',
        '--kind',
        'monograph',
      ]);
      expect(code).toBe(2);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('--kind must be "archival-item" for --repository "new-italy-museum"'),
      );
    },
  );
});
