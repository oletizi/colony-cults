import { describe, it, expect } from 'vitest';
import { assertOcrToolchain, type OcrPreflightDeps } from '@/ocr/preflight';

/**
 * Unit coverage for the OCR toolchain preflight (T029/T032, FR-013). Every
 * scenario injects a fake `pathLookup` + command runner -- no real
 * `ocrmypdf`/`img2pdf`/`pdftotext`/`tesseract` is ever required.
 */

function fakeDeps(options: {
  missingTools?: string[];
  langs?: string[];
}): OcrPreflightDeps {
  const missingTools = new Set(options.missingTools ?? []);
  const langs = options.langs ?? ['eng', 'fra'];
  return {
    pathLookup: async (command) => !missingTools.has(command),
    run: {
      run: async (command, args) => {
        if (command === 'tesseract' && args[0] === '--list-langs') {
          return {
            stdout: ['List of available languages (2):', ...langs].join('\n'),
            stderr: '',
            exitCode: 0,
          };
        }
        throw new Error(`fakeDeps: unexpected command "${command}"`);
      },
    },
  };
}

describe('assertOcrToolchain (T029/T032)', () => {
  it('resolves when ocrmypdf/img2pdf/pdftotext/tesseract are present and fra is installed', async () => {
    await expect(assertOcrToolchain(fakeDeps({}))).resolves.toBeUndefined();
  });

  it('throws naming a single missing tool plus the install command', async () => {
    await expect(
      assertOcrToolchain(fakeDeps({ missingTools: ['ocrmypdf'] })),
    ).rejects.toThrow(
      /ocrmypdf.*brew install ocrmypdf tesseract-lang img2pdf poppler/s,
    );
  });

  it('throws naming every missing tool at once', async () => {
    await expect(
      assertOcrToolchain(
        fakeDeps({ missingTools: ['ocrmypdf', 'img2pdf', 'pdftotext'] }),
      ),
    ).rejects.toThrow(/ocrmypdf.*img2pdf.*pdftotext/s);
  });

  it('throws naming tesseract itself when it is absent', async () => {
    await expect(
      assertOcrToolchain(fakeDeps({ missingTools: ['tesseract'] })),
    ).rejects.toThrow(/tesseract/);
  });

  it('throws naming the missing "fra" language data when tesseract lacks it', async () => {
    await expect(
      assertOcrToolchain(fakeDeps({ langs: ['eng'] })),
    ).rejects.toThrow(/fra/);
  });

  it('always includes the install command in the failure message', async () => {
    await expect(
      assertOcrToolchain(fakeDeps({ langs: ['eng'] })),
    ).rejects.toThrow(/brew install ocrmypdf tesseract-lang img2pdf poppler/);
  });
});
