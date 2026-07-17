import { describe, it, expect } from 'vitest';
import type { ExecResult } from '@/ocr/exec';
import { PopplerRunnerImpl } from '@/pdf/poppler/runner';

/**
 * Tests for `PopplerRunnerImpl` -- the injected poppler wrapper (T011/T012).
 * NO real process is ever spawned here: every test injects a fake command
 * runner and asserts either (a) the parsed return value against REAL captured
 * `pdfimages -list` / `pdfinfo` stdout (captured by hand against the repo's
 * two synthetic fixtures, `src/repository/internet-archive/__fixtures__/
 * single-image-page.pdf` and `.../overlay-page.pdf`), or (b) the exact argv
 * handed to the injected runner.
 */

/** Build a fake `CommandRunner` that returns a fixed result regardless of argv, and records every call. */
function fakeRunner(result: ExecResult): {
  run: (command: string, args: string[]) => Promise<ExecResult>;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run = (command: string, args: string[]): Promise<ExecResult> => {
    calls.push({ command, args });
    return Promise.resolve(result);
  };
  return { run, calls };
}

// Captured verbatim via:
//   pdfimages -list src/repository/internet-archive/__fixtures__/single-image-page.pdf
// Two pages, each holding exactly one distinct image object (object IDs 10 and 2).
const SINGLE_IMAGE_PAGE_LIST_STDOUT = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   1     0 image      64    96  rgb     3   8  image  no        10  0    96    96  270B 1.5%
   2     1 image      64    96  rgb     3   8  image  no         2  0    96    96  256B 1.4%
`;

// Captured verbatim via:
//   pdfimages -list src/repository/internet-archive/__fixtures__/overlay-page.pdf
// Two pages that both reference the SAME object ID (5) -- a shared/overlay
// image reused across pages -- exercising the parser against a repeated
// object ID rather than assuming ids are unique per row.
const OVERLAY_PAGE_LIST_STDOUT = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   1     0 image      64    96  rgb     3   8  image  no         5  0    46    46   97B 0.5%
   2     1 image      64    96  rgb     3   8  image  no         5  0    46    46   97B 0.5%
`;

// Captured verbatim via:
//   pdfinfo src/repository/internet-archive/__fixtures__/single-image-page.pdf
const SINGLE_IMAGE_PAGE_INFO_STDOUT = `Producer:        img2pdf 0.6.3
CreationDate:    Thu Jul 16 14:23:11 2026 PDT
ModDate:         Thu Jul 16 14:23:11 2026 PDT
Custom Metadata: no
Metadata Stream: no
Tagged:          no
UserProperties:  no
Suspects:        no
Form:            none
JavaScript:      no
Pages:           2
Encrypted:       no
Page size:       48 x 72 pts
Page rot:        0
File size:       2595 bytes
Optimized:       yes
PDF version:     1.3
`;

describe('PopplerRunnerImpl.imagesList', () => {
  it('parses the header + separator rows and returns one entry per data row (single-image-page fixture)', async () => {
    const { run } = fakeRunner({ stdout: SINGLE_IMAGE_PAGE_LIST_STDOUT, stderr: '', exitCode: 0 });
    const runner = new PopplerRunnerImpl(run);

    const result = await runner.imagesList('single-image-page.pdf');

    expect(result).toEqual([
      { page: 1, num: 0, width: 64, height: 96, objectId: '10', xPpi: 96 },
      { page: 2, num: 1, width: 64, height: 96, objectId: '2', xPpi: 96 },
    ]);
  });

  it('parses a fixture where two pages share the same object ID (overlay-page fixture)', async () => {
    const { run } = fakeRunner({ stdout: OVERLAY_PAGE_LIST_STDOUT, stderr: '', exitCode: 0 });
    const runner = new PopplerRunnerImpl(run);

    const result = await runner.imagesList('overlay-page.pdf');

    expect(result).toEqual([
      { page: 1, num: 0, width: 64, height: 96, objectId: '5', xPpi: 46 },
      { page: 2, num: 1, width: 64, height: 96, objectId: '5', xPpi: 46 },
    ]);
  });

  it('invokes the injected runner with the exact pdfimages -list argv', async () => {
    const { run, calls } = fakeRunner({
      stdout: SINGLE_IMAGE_PAGE_LIST_STDOUT,
      stderr: '',
      exitCode: 0,
    });
    const runner = new PopplerRunnerImpl(run);

    await runner.imagesList('/path/to/single-image-page.pdf');

    expect(calls).toEqual([
      { command: 'pdfimages', args: ['-list', '/path/to/single-image-page.pdf'] },
    ]);
  });

  it('fails loud, naming the command and stderr, on a non-zero exit code', async () => {
    const { run } = fakeRunner({ stdout: '', stderr: 'Syntax Error: broken pdf', exitCode: 1 });
    const runner = new PopplerRunnerImpl(run);

    await expect(runner.imagesList('bad.pdf')).rejects.toThrow(/pdfimages/);
    await expect(runner.imagesList('bad.pdf')).rejects.toThrow(/Syntax Error: broken pdf/);
  });

  it('fails loud on a header line with no separator row (unrecognized output shape)', async () => {
    const { run } = fakeRunner({ stdout: 'not a real pdfimages table\n', stderr: '', exitCode: 0 });
    const runner = new PopplerRunnerImpl(run);

    await expect(runner.imagesList('weird.pdf')).rejects.toThrow(/pdfimages/);
  });
});

describe('PopplerRunnerImpl.info', () => {
  it('parses the "Pages:" line from real pdfinfo output', async () => {
    const { run } = fakeRunner({
      stdout: SINGLE_IMAGE_PAGE_INFO_STDOUT,
      stderr: '',
      exitCode: 0,
    });
    const runner = new PopplerRunnerImpl(run);

    const result = await runner.info('single-image-page.pdf');

    expect(result).toEqual({ pages: 2 });
  });

  it('invokes the injected runner with the exact pdfinfo argv', async () => {
    const { run, calls } = fakeRunner({
      stdout: SINGLE_IMAGE_PAGE_INFO_STDOUT,
      stderr: '',
      exitCode: 0,
    });
    const runner = new PopplerRunnerImpl(run);

    await runner.info('/path/to/single-image-page.pdf');

    expect(calls).toEqual([{ command: 'pdfinfo', args: ['/path/to/single-image-page.pdf'] }]);
  });

  it('fails loud, naming the command and stderr, on a non-zero exit code', async () => {
    const { run } = fakeRunner({ stdout: '', stderr: 'Command Line Error: bad arg', exitCode: 2 });
    const runner = new PopplerRunnerImpl(run);

    await expect(runner.info('bad.pdf')).rejects.toThrow(/pdfinfo/);
    await expect(runner.info('bad.pdf')).rejects.toThrow(/Command Line Error: bad arg/);
  });

  it('fails loud when no "Pages:" line is present', async () => {
    const { run } = fakeRunner({ stdout: 'Producer: img2pdf\n', stderr: '', exitCode: 0 });
    const runner = new PopplerRunnerImpl(run);

    await expect(runner.info('weird.pdf')).rejects.toThrow(/pdfinfo/);
  });
});

describe('PopplerRunnerImpl.extractImage', () => {
  it('invokes pdfimages with -f/-l/-png for a single page, lossless decoded extraction', async () => {
    const { run, calls } = fakeRunner({ stdout: '', stderr: '', exitCode: 0 });
    const runner = new PopplerRunnerImpl(run);

    await runner.extractImage('/path/to/doc.pdf', 3, '/out/doc-p3');

    expect(calls).toEqual([
      { command: 'pdfimages', args: ['-f', '3', '-l', '3', '-png', '/path/to/doc.pdf', '/out/doc-p3'] },
    ]);
  });

  it('fails loud, naming the command and stderr, on a non-zero exit code', async () => {
    const { run } = fakeRunner({ stdout: '', stderr: 'boom', exitCode: 1 });
    const runner = new PopplerRunnerImpl(run);

    await expect(runner.extractImage('doc.pdf', 1, '/out/p1')).rejects.toThrow(/pdfimages/);
    await expect(runner.extractImage('doc.pdf', 1, '/out/p1')).rejects.toThrow(/boom/);
  });
});

describe('PopplerRunnerImpl.rasterise', () => {
  it('invokes pdftoppm with -f/-l/-r/-png for a single page at the given DPI', async () => {
    const { run, calls } = fakeRunner({ stdout: '', stderr: '', exitCode: 0 });
    const runner = new PopplerRunnerImpl(run);

    await runner.rasterise('/path/to/doc.pdf', 5, 300, '/out/doc-p5');

    expect(calls).toEqual([
      {
        command: 'pdftoppm',
        args: ['-f', '5', '-l', '5', '-r', '300', '-png', '/path/to/doc.pdf', '/out/doc-p5'],
      },
    ]);
  });

  it('fails loud, naming the command and stderr, on a non-zero exit code', async () => {
    const { run } = fakeRunner({ stdout: '', stderr: 'rasterise failed', exitCode: 1 });
    const runner = new PopplerRunnerImpl(run);

    await expect(runner.rasterise('doc.pdf', 1, 300, '/out/p1')).rejects.toThrow(/pdftoppm/);
    await expect(runner.rasterise('doc.pdf', 1, 300, '/out/p1')).rejects.toThrow(
      /rasterise failed/,
    );
  });
});
