import { describe, it, expect } from 'vitest';
import { createEngine } from '@/engine/factory';

describe('createEngine', () => {
  it('builds the claude engine + preflight', () => {
    const { engine, preflight } = createEngine('claude');
    expect(engine.name).toBe('claude-code-cli');
    expect(typeof preflight).toBe('function');
  });

  it('builds the codex engine + preflight', () => {
    const { engine, preflight } = createEngine('codex');
    expect(engine.name).toBe('codex-cli');
    expect(typeof preflight).toBe('function');
  });
});
