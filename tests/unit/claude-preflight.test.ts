import { describe, it, expect } from 'vitest';
import { assertClaudeAvailable, type ClaudePreflightDeps } from '@/claude/preflight';

/**
 * Unit coverage for the Claude CLI preflight (T005/T013, FR-009). Every
 * scenario injects a fake `pathLookup` + command runner -- no real `claude`
 * process is ever spawned.
 */

function fakeDeps(options: {
  present?: boolean;
  versionExitCode?: number;
}): ClaudePreflightDeps {
  const present = options.present ?? true;
  const versionExitCode = options.versionExitCode ?? 0;
  return {
    pathLookup: async (command) => command === 'claude' && present,
    run: {
      run: async (command, args) => {
        if (command === 'claude' && args[0] === '--version') {
          return { stdout: 'Claude Code 1.0.0', stderr: '', exitCode: versionExitCode };
        }
        throw new Error(`fakeDeps: unexpected command "${command} ${args.join(' ')}"`);
      },
    },
  };
}

describe('assertClaudeAvailable (T005/T013)', () => {
  it('resolves when the injected PATH lookup finds claude and it reports its version', async () => {
    await expect(assertClaudeAvailable(fakeDeps({}))).resolves.toBeUndefined();
  });

  it('throws naming claude plus install/auth instructions when the lookup reports it absent', async () => {
    await expect(assertClaudeAvailable(fakeDeps({ present: false }))).rejects.toThrow(
      /claude.*install.*claude login/is,
    );
  });

  it('throws naming claude plus install/auth instructions when the version probe fails', async () => {
    await expect(
      assertClaudeAvailable(fakeDeps({ versionExitCode: 1 })),
    ).rejects.toThrow(/claude.*install.*claude login/is);
  });

  it('never invokes a real process -- only the injected fake pathLookup/runner are called', async () => {
    let pathLookupCalls = 0;
    let runCalls = 0;
    const deps: ClaudePreflightDeps = {
      pathLookup: async (command) => {
        pathLookupCalls += 1;
        return command === 'claude';
      },
      run: {
        run: async (command, args) => {
          runCalls += 1;
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      },
    };
    await assertClaudeAvailable(deps);
    expect(pathLookupCalls).toBeGreaterThan(0);
    expect(runCalls).toBeGreaterThan(0);
  });
});
