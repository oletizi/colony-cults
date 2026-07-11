import { describe, it, expect } from 'vitest';
import { assertCodexAvailable, type CodexPreflightDeps } from '@/codex/preflight';

/**
 * Unit coverage for the Codex CLI preflight (T4, codex analog of
 * assertClaudeAvailable). Every scenario injects a fake `pathLookup` + command
 * runner -- no real `codex` process is ever spawned.
 */

function fakeDeps(options: {
  present?: boolean;
  versionExitCode?: number;
}): CodexPreflightDeps {
  const present = options.present ?? true;
  const versionExitCode = options.versionExitCode ?? 0;
  return {
    pathLookup: async (command) => command === 'codex' && present,
    run: {
      run: async (command, args) => {
        if (command === 'codex' && args[0] === '--version') {
          return { stdout: 'codex-cli 0.141.0', stderr: '', exitCode: versionExitCode };
        }
        throw new Error(`fakeDeps: unexpected command "${command} ${args.join(' ')}"`);
      },
    },
  };
}

describe('assertCodexAvailable', () => {
  it('resolves when codex is on PATH and runnable', async () => {
    await expect(assertCodexAvailable(fakeDeps({}))).resolves.toBeUndefined();
  });

  it('throws naming codex plus install/login instructions when the lookup reports it absent', async () => {
    await expect(assertCodexAvailable(fakeDeps({ present: false }))).rejects.toThrow(
      /codex.*install.*codex login/is,
    );
  });

  it('throws naming codex plus install/login instructions when the version probe fails', async () => {
    await expect(
      assertCodexAvailable(fakeDeps({ versionExitCode: 1 })),
    ).rejects.toThrow(/codex.*install.*codex login/is);
  });

  it('never invokes a real process -- only the injected fake pathLookup/runner are called', async () => {
    let pathLookupCalls = 0;
    let runCalls = 0;
    const deps: CodexPreflightDeps = {
      pathLookup: async (command) => {
        pathLookupCalls += 1;
        return command === 'codex';
      },
      run: {
        run: async () => {
          runCalls += 1;
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      },
    };
    await assertCodexAvailable(deps);
    expect(pathLookupCalls).toBeGreaterThan(0);
    expect(runCalls).toBeGreaterThan(0);
  });
});
