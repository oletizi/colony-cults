import { execCommand } from '@/ocr/exec';
import type { OcrCommandRunner, PathLookup } from '@/ocr/types';

/** Command-line tools (besides `tesseract` itself) required for OCR. */
const REQUIRED_TOOLS = ['ocrmypdf', 'img2pdf', 'pdftotext'] as const;

/** Tesseract language code the recognition data must include (FR-013). */
const REQUIRED_LANGUAGE = 'fra';

/** Printed verbatim in the failure message so the operator can act on it. */
const INSTALL_COMMAND = 'brew install ocrmypdf tesseract-lang img2pdf poppler';

/** Injectable dependencies of {@link assertOcrToolchain} (T029). */
export interface OcrPreflightDeps {
  /** Resolve whether a command name is present on `PATH`. */
  pathLookup: PathLookup;
  /** Run `tesseract --list-langs` (or any other diagnostic command). */
  run: OcrCommandRunner;
}

/** Real (PATH-lookup + shell-out) preflight dependencies. */
export function defaultOcrPreflightDeps(): OcrPreflightDeps {
  return {
    pathLookup: async (command) =>
      (await execCommand('which', [command])).exitCode === 0,
    run: { run: (command, args) => execCommand(command, args) },
  };
}

/** Parse `tesseract --list-langs` output into the set of installed codes. */
function parseLanguages(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith('list of'));
}

/**
 * Validate that the OCR toolchain -- `ocrmypdf`, `img2pdf`, `pdftotext`, and
 * Tesseract with the French (`fra`) recognition data -- is present, throwing
 * a descriptive Error naming exactly what is missing plus the install
 * command when it is not (FR-013). This check MUST run only when OCR is
 * requested (T031 wires that); it never runs on an images-only path.
 *
 * `pathLookup` and `run` are injected so unit/integration tests can simulate
 * any present/absent combination without a real OCR toolchain (T032).
 */
export async function assertOcrToolchain(
  deps: OcrPreflightDeps = defaultOcrPreflightDeps(),
): Promise<void> {
  const missing: string[] = [];

  for (const tool of REQUIRED_TOOLS) {
    if (!(await deps.pathLookup(tool))) {
      missing.push(tool);
    }
  }

  if (!(await deps.pathLookup('tesseract'))) {
    missing.push('tesseract');
  } else {
    const result = await deps.run.run('tesseract', ['--list-langs']);
    const languages = parseLanguages(result.stdout);
    if (!languages.includes(REQUIRED_LANGUAGE)) {
      missing.push(`tesseract language data "${REQUIRED_LANGUAGE}"`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `OCR toolchain preflight failed -- missing: ${missing.join(', ')}. ` +
        `Install with: ${INSTALL_COMMAND}`,
    );
  }
}
