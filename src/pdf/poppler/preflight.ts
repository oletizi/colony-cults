import { execCommand } from '@/ocr/exec';
import type { PathLookup } from '@/ocr/types';

/** Command-line tools from the `poppler` suite required for PDF operations. */
const REQUIRED_TOOLS = ['pdfimages', 'pdftoppm', 'pdfinfo'] as const;

/** Printed verbatim in the failure message so the operator can act on it. */
const INSTALL_COMMAND = 'brew install poppler';

/** Injectable dependencies of {@link assertPopplerToolchain}. */
export interface PopplerPreflightDeps {
  /** Resolve whether a command name is present on `PATH`. */
  pathLookup: PathLookup;
}

/** Real (PATH-lookup) preflight dependencies. */
export function defaultPopplerPreflightDeps(): PopplerPreflightDeps {
  return {
    pathLookup: async (command) =>
      (await execCommand('which', [command])).exitCode === 0,
  };
}

/**
 * Validate that the Poppler toolchain -- `pdfimages`, `pdftoppm`, and
 * `pdfinfo` -- is present, throwing a descriptive Error naming exactly what
 * is missing plus the install command when it is not. This check MUST run
 * only when Poppler-based PDF operations are requested; it never runs on
 * paths that do not require these utilities.
 *
 * `pathLookup` is injected so unit tests can simulate any present/absent
 * combination without a real Poppler toolchain.
 */
export async function assertPopplerToolchain(
  deps: PopplerPreflightDeps = defaultPopplerPreflightDeps(),
): Promise<void> {
  const missing: string[] = [];

  for (const tool of REQUIRED_TOOLS) {
    if (!(await deps.pathLookup(tool))) {
      missing.push(tool);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Poppler toolchain preflight failed -- missing: ${missing.join(', ')}. ` +
        `Install with: ${INSTALL_COMMAND}`,
    );
  }
}
