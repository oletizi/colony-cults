import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const distIndex = path.join(repoRoot, 'dist', 'index.js');

describe('built bib bin runs under plain node (no tsx)', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
  }, 120_000);

  it('emits dist/index.js with a node shebang', () => {
    expect(existsSync(distIndex)).toBe(true);
    const first = execFileSync('head', ['-1', distIndex], { encoding: 'utf-8' });
    expect(first.trim()).toBe('#!/usr/bin/env node');
  });

  it('runs `node dist/index.js --help` and prints bib help', () => {
    const out = execFileSync('node', [distIndex, '--help'], { encoding: 'utf-8' });
    expect(out).toContain('bib');
    expect(out).toContain('query-source');
  });

  it('runs `node dist/index.js --version` and prints a version', () => {
    const out = execFileSync('node', [distIndex, '--version'], { encoding: 'utf-8' });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
