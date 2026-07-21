import type { ExecResult } from '@/ocr/exec';

/**
 * A single injected command-execution capability. `assertOcrToolchain`
 * (preflight.ts) uses it to run `tesseract --list-langs`; `ocrIssue`
 * (run.ts) uses it to run `img2pdf`/`ocrmypdf`/`pdftotext`. The real
 * implementation shells out (see `exec.ts`); tests inject a fake so no real
 * OCR toolchain is ever required to exercise this code (T029/T030/T032/T033).
 */
export interface OcrCommandRunner {
  /**
   * Run one external command. `stdin`, when provided, is written to the child's
   * standard input (e.g. the token stream piped to `aspell … list` for the OCR
   * quality score). The image-toolchain callers (`img2pdf`/`ocrmypdf`/
   * `pdftotext`) pass no stdin, unchanged.
   */
  run(command: string, args: string[], stdin?: string): Promise<ExecResult>;
}

/** Resolve whether a command name is available on `PATH`. */
export interface PathLookup {
  (command: string): Promise<boolean>;
}
