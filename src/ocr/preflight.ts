import { execCommand } from '@/ocr/exec';
import { aspellLanguageFor } from '@/ocr/quality';
import type { OcrCommandRunner, PathLookup } from '@/ocr/types';

/**
 * Command-line tools (besides `tesseract` itself) required for OCR. `aspell` is
 * required because every OCR run now computes a mandatory quality score from
 * its dictionary (`@/ocr/quality`).
 */
const REQUIRED_TOOLS = ['ocrmypdf', 'img2pdf', 'pdftotext', 'aspell'] as const;

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

/** What a specific OCR run needs, beyond the always-required base toolchain. */
export interface OcrPreflightOptions {
  /**
   * Tesseract language code(s) the recognition data must include -- each
   * element of a `+`-joined `--language` set (e.g. `['eng','fra']`). Omitted ->
   * the `fra` default, so existing French-only OCR preflight is unchanged.
   */
  languages?: string[];
  /** Also require ImageMagick `magick` (the `--enhance-contrast` preprocessing tool). */
  enhanceContrast?: boolean;
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
  options: OcrPreflightOptions = {},
): Promise<void> {
  const missing: string[] = [];
  const requiredLanguages =
    options.languages !== undefined && options.languages.length > 0
      ? options.languages
      : [REQUIRED_LANGUAGE];

  for (const tool of REQUIRED_TOOLS) {
    if (!(await deps.pathLookup(tool))) {
      missing.push(tool);
    }
  }

  // ImageMagick is only needed for the opt-in contrast-enhancement pass.
  if (options.enhanceContrast === true && !(await deps.pathLookup('magick'))) {
    missing.push('magick (ImageMagick)');
  }

  if (!(await deps.pathLookup('tesseract'))) {
    missing.push('tesseract');
  } else {
    const result = await deps.run.run('tesseract', ['--list-langs']);
    const installed = parseLanguages(result.stdout);
    for (const lang of requiredLanguages) {
      if (!installed.includes(lang)) {
        missing.push(`tesseract language data "${lang}"`);
      }
    }
  }

  // The OCR quality score needs an aspell dictionary for each language it will
  // score against (the aspell code mapped from the tesseract code).
  if (await deps.pathLookup('aspell')) {
    const result = await deps.run.run('aspell', ['dump', 'dicts']);
    const available = new Set(
      result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );
    for (const lang of requiredLanguages) {
      const aspellCode = aspellLanguageFor(lang);
      if (!available.has(aspellCode)) {
        missing.push(`aspell dictionary "${aspellCode}"`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `OCR toolchain preflight failed -- missing: ${missing.join(', ')}. ` +
        `Install with: ${INSTALL_COMMAND}`,
    );
  }
}
