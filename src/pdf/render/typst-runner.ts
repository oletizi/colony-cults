/**
 * Drives the external `typst compile` process to render one PDF from a
 * serialized `TypstInput` (specs/007-corpus-print-pdf/contracts/typst-template.md,
 * G-5). Typst's layout is never reimplemented here -- this module only shells
 * out (Principle VIII, Faithful Tool Adoption) via an injected `ExecRunner`,
 * mirroring `@/claude/exec`'s `ClaudeCommandRunner` / `@/ocr/types`'
 * `OcrCommandRunner` shape so production wiring reuses the same real,
 * non-rejecting `execCommand` from `@/ocr/exec` and tests inject a fake
 * runner instead of requiring a real `typst` binary.
 */

import { execCommand, type ExecResult } from '@/ocr/exec';

/**
 * A single injected command-execution capability. The real implementation
 * shells out via `@/ocr/exec`'s `execCommand`; tests inject a fake so no real
 * `typst` binary is ever required to exercise this module.
 */
export interface ExecRunner {
  run(command: string, args: string[], stdin?: string): Promise<ExecResult>;
}

/** The real (shell-out) exec runner, used by CLI/build wiring in production. */
export function defaultExecRunner(): ExecRunner {
  return { run: (command, args, stdin) => execCommand(command, args, stdin) };
}

/** One `typst compile` invocation's inputs. */
export interface CompileRequest {
  /** Path to the Typst template entry point (`pdf/template/edition.typ`). */
  templatePath: string;
  /** Path to the serialized `TypstInput` JSON (`serializeTypstInput` output). */
  inputPath: string;
  /** Directory containing the verso images the template's `imagePath`s resolve against. */
  imageDir: string;
  /** Destination path for the rendered PDF. */
  outPath: string;
}

/** One `typst compile` invocation's result. */
export interface CompileResult {
  /** The path the PDF was written to -- always `CompileRequest.outPath`. */
  outPath: string;
}

/** Compiles a `CompileRequest` to a PDF via the external `typst` CLI. */
export interface TypstRunner {
  compile(req: CompileRequest): Promise<CompileResult>;
}

const TYPST_COMMAND = 'typst';

/**
 * The template reads the input document via Typst's `sys.inputs` (research
 * Decision 1): the compiled `TypstInput` JSON is exposed as the `data` input
 * and the verso image directory as the `images` input, both passed as
 * `--input key=value` string pairs.
 */
function compileArgs(req: CompileRequest): string[] {
  return [
    'compile',
    req.templatePath,
    req.outPath,
    '--input',
    `data=${req.inputPath}`,
    '--input',
    `images=${req.imageDir}`,
  ];
}

/**
 * Builds a `TypstRunner` that shells `typst compile` via the injected
 * `ExecRunner` (G-5). `execCommand` never rejects -- a missing `typst`
 * binary or a template error both surface as a non-zero `exitCode` -- so
 * this function converts that into a single, fail-loud throw carrying
 * Typst's captured stderr verbatim. No layout or PDF composition is
 * reimplemented in TypeScript.
 */
export function makeTypstRunner(exec: ExecRunner): TypstRunner {
  return {
    async compile(req: CompileRequest): Promise<CompileResult> {
      const result = await exec.run(TYPST_COMMAND, compileArgs(req));
      if (result.exitCode !== 0) {
        throw new Error(
          `makeTypstRunner: "typst compile" failed (exit ${result.exitCode}) for template ` +
            `${req.templatePath} -> ${req.outPath}: ` +
            `${result.stderr.trim() || result.stdout.trim() || '(no output; is "typst" on PATH?)'}`
        );
      }
      return { outPath: req.outPath };
    },
  };
}
