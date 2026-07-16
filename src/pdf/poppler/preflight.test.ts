import { describe, it, expect } from 'vitest';
import { assertPopplerToolchain } from '@/pdf/poppler/preflight';
import type { PathLookup } from '@/ocr/types';

describe('assertPopplerToolchain', () => {
  it('passes when all three poppler tools are present', async () => {
    const allPresentLookup: PathLookup = async () => true;
    await expect(
      assertPopplerToolchain({ pathLookup: allPresentLookup }),
    ).resolves.toBeUndefined();
  });

  it('throws descriptive error when pdfimages is missing', async () => {
    const missingPdfimagesLookup: PathLookup = async (command) => {
      if (command === 'pdfimages') return false;
      return true;
    };
    await expect(
      assertPopplerToolchain({ pathLookup: missingPdfimagesLookup }),
    ).rejects.toThrow(/pdfimages/);
    await expect(
      assertPopplerToolchain({ pathLookup: missingPdfimagesLookup }),
    ).rejects.toThrow(/brew install/);
  });

  it('throws descriptive error when pdftoppm is missing', async () => {
    const missingPdftoppmLookup: PathLookup = async (command) => {
      if (command === 'pdftoppm') return false;
      return true;
    };
    await expect(
      assertPopplerToolchain({ pathLookup: missingPdftoppmLookup }),
    ).rejects.toThrow(/pdftoppm/);
    await expect(
      assertPopplerToolchain({ pathLookup: missingPdftoppmLookup }),
    ).rejects.toThrow(/brew install/);
  });

  it('throws descriptive error when pdfinfo is missing', async () => {
    const missingPdfinfocLookup: PathLookup = async (command) => {
      if (command === 'pdfinfo') return false;
      return true;
    };
    await expect(
      assertPopplerToolchain({ pathLookup: missingPdfinfocLookup }),
    ).rejects.toThrow(/pdfinfo/);
    await expect(
      assertPopplerToolchain({ pathLookup: missingPdfinfocLookup }),
    ).rejects.toThrow(/brew install/);
  });

  it('throws error naming all missing tools when multiple are absent', async () => {
    const missingMultipleLookup: PathLookup = async (command) => {
      if (command === 'pdfimages' || command === 'pdfinfo') return false;
      return true;
    };
    const error = await assertPopplerToolchain({
      pathLookup: missingMultipleLookup,
    }).catch((e) => e);
    expect(error.message).toContain('pdfimages');
    expect(error.message).toContain('pdfinfo');
    expect(error.message).toContain('brew install');
  });
});
