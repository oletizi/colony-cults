import { execFile } from 'node:child_process';

/** Outcome of running one external OCR-toolchain command to completion. */
export interface ExecResult {
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
  /** Process exit code (`0` on success). */
  exitCode: number;
}

/**
 * Run an external command to completion, capturing its output. This is the
 * ONLY place the OCR layer shells out to a real process -- `preflight.ts` and
 * `run.ts` build their default (real) dependencies from it; tests never call
 * it, injecting a fake command runner instead.
 *
 * Never rejects on a non-zero exit or a missing executable -- both are
 * reported via `exitCode` (a missing executable surfaces as a non-zero,
 * platform-dependent code) so callers can produce one descriptive, fail-loud
 * message rather than juggling thrown vs. returned failures.
 */
export function execCommand(command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { maxBuffer: 1024 * 1024 * 64 },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === 'number' ? error.code : 1;
          resolve({ stdout, stderr, exitCode });
          return;
        }
        resolve({ stdout, stderr, exitCode: 0 });
      },
    );
  });
}
