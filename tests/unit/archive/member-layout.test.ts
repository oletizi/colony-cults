import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureMemberLayoutRegistered } from '@/archive/member-layout';
import { sourceLayout, isSourceLayoutRegistered } from '@/archive/location';

/**
 * The member-layout bridge lets ocr/translate/restore-images resolve a
 * source-group MEMBER's archive layout (which lives only in the runtime
 * overlay, registered by `bib acquire`) by deriving+registering the same slug
 * from the bibliography. Unique PB-P9xx ids keep the process-global overlay
 * from colliding with other suites.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sourcesDirWith(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cc-member-layout-'));
  dirs.push(root);
  const dir = path.join(root, 'bibliography', 'sources');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

const GROUP = `sourceId: PB-P940
kind: source-group
case: port-breton
titles:
  - text: A legal-proceedings group
    role: canonical
`;

const MEMBER = `sourceId: PB-P941
kind: monograph
partOf: PB-P940
case: port-breton
titles:
  - text: La Vérité sur la colonie de Port-Breton
    role: canonical
`;

describe('ensureMemberLayoutRegistered', () => {
  it('derives + registers a member layout so sourceLayout resolves it', () => {
    const sourcesDir = sourcesDirWith({
      'PB-P940.yml': GROUP,
      'PB-P941.yml': MEMBER,
    });
    expect(isSourceLayoutRegistered('PB-P941')).toBe(false);

    ensureMemberLayoutRegistered('PB-P941', sourcesDir);

    const layout = sourceLayout('PB-P941');
    expect(layout.kind).toBe('monograph');
    expect(layout.case).toBe('port-breton');
    expect(layout.type).toBe('books');
    // Slug derived from the title (accents transliterated, non-alnum -> '-').
    expect(layout.slug).toBe('la-verite-sur-la-colonie-de-port-breton');
  });

  it('is a no-op for a source already in the static registry (no divergent slug)', () => {
    const sourcesDir = sourcesDirWith({ 'PB-P940.yml': GROUP });
    // PB-P002 is a static monograph with a HAND-SET slug; the bridge must not
    // re-derive it (which would produce a different slug from the title).
    ensureMemberLayoutRegistered('PB-P002', sourcesDir);
    expect(sourceLayout('PB-P002').slug).toBe(
      'nouvelle-france-colonie-libre-port-breton',
    );
  });

  it('is a no-op for an unknown id (leaves resolution to the caller)', () => {
    const sourcesDir = sourcesDirWith({ 'PB-P940.yml': GROUP });
    ensureMemberLayoutRegistered('PB-P999', sourcesDir);
    expect(isSourceLayoutRegistered('PB-P999')).toBe(false);
  });

  it('is a no-op for a source-group id (no archival object)', () => {
    const sourcesDir = sourcesDirWith({ 'PB-P940.yml': GROUP });
    ensureMemberLayoutRegistered('PB-P940', sourcesDir);
    expect(isSourceLayoutRegistered('PB-P940')).toBe(false);
  });
});
