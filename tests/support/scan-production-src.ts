/**
 * Shared scanning support for the corpus-config-seam regression guards
 * (T019/T020, specs/018-corpus-config-seam SC-004/FR-012/FR-016).
 *
 * Both guards need the same primitive: "every production `.ts` module under
 * `src/`, with comments stripped so a live code literal can be told apart
 * from prose that merely MENTIONS a retired/forbidden name." This module is
 * the single owner of that primitive so the two guard tests do not each grow
 * their own ad hoc file-walking/comment-stripping logic.
 *
 * PRODUCTION SOURCE, PRECISELY: `.ts` files under `src/`, excluding:
 *   - `*.test.ts` — this repo co-locates unit tests beside their module
 *     (e.g. `src/corpus/manifest.test.ts`), so `src/**\/*.ts` alone is NOT
 *     "production code"; a test file legitimately names `PB-P` ids, the
 *     retired constant names (as fixtures), etc.
 *   - any path with a `__fixtures__` path segment — fixture data, not
 *     shipped logic.
 *   - non-`.ts` files (e.g. `.md`) even though some sit inside `src/`.
 *
 * COMMENT STRIPPING: uses the TypeScript compiler's own scanner
 * (`ts.createScanner`) to walk every token in the file and blank out the
 * text of every `SingleLineCommentTrivia`/`MultiLineCommentTrivia` span. This
 * is exact (unlike a hand-rolled `//`/`/* *\/` regex) because it is the same
 * tokenizer the compiler itself uses to separate trivia from code -- so a
 * `//` or `/*` inside a string or regex literal is never mistaken for a
 * comment start, and a genuine comment is never left un-blanked because of
 * some quoting edge case. Blanked comment spans are replaced with spaces
 * (not removed) so every remaining character's offset in the returned string
 * still matches the original file, which keeps line-oriented error messages
 * useful if a caller wants them.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';

/** One production source file: absolute + repo-relative path, plus its live (comment-stripped) code. */
export interface ProductionSourceFile {
  /** Absolute path. */
  readonly absPath: string;
  /** Path relative to the repo root, for readable assertion messages. */
  readonly relPath: string;
  /** The file's full original text, unchanged. */
  readonly rawText: string;
  /** `rawText` with every comment span blanked to spaces (see module doc). */
  readonly liveCode: string;
}

/** True when `name` is a `.ts` file this guard should treat as production code. */
function isProductionTsFile(name: string): boolean {
  return name.endsWith('.ts') && !name.endsWith('.test.ts');
}

/** Recursively collect every production `.ts` file under `dir`, skipping `__fixtures__` trees. */
function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === '__fixtures__') {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (stat.isFile() && isProductionTsFile(entry)) {
      out.push(full);
    }
  }
}

/**
 * Blank every comment token's text (replacing each character with a space,
 * preserving newlines) using the TS compiler's own scanner, so string/regex
 * literals containing `//` or `/*` are never mistaken for comments and no
 * real comment survives due to a quoting edge case.
 */
export function stripComments(sourceText: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    sourceText,
  );

  const chars = sourceText.split('');

  // Plain `scanner.scan()` does not know that a `}` might be closing a
  // `${...}` template substitution rather than a block/object -- that
  // requires `reScanTemplateToken()`, which the scanner will only do on
  // request. Without this, the FIRST `${...}` in the file (this codebase
  // uses template literals for essentially every error message) desyncs
  // every token position after it, silently hiding every comment past that
  // point -- exactly the false-negative a "prove it has teeth" review would
  // catch, so it is handled explicitly here: a stack of the brace depth
  // active when each `TemplateHead`/template-substitution opened, matched
  // against a live brace-depth counter so a `}` that belongs to an ordinary
  // block/object (not the template) still falls through to normal handling.
  const templateSubstitutionDepths: number[] = [];
  let braceDepth = 0;

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const start = scanner.getTokenStart();
      const end = scanner.getTokenEnd();
      for (let i = start; i < end; i++) {
        if (chars[i] !== '\n' && chars[i] !== '\r') {
          chars[i] = ' ';
        }
      }
    } else if (token === ts.SyntaxKind.TemplateHead) {
      templateSubstitutionDepths.push(braceDepth);
    } else if (token === ts.SyntaxKind.OpenBraceToken) {
      braceDepth++;
    } else if (token === ts.SyntaxKind.CloseBraceToken) {
      const top = templateSubstitutionDepths[templateSubstitutionDepths.length - 1];
      if (top !== undefined && top === braceDepth) {
        // This `}` closes a template substitution, not a block/object --
        // resume template-literal scanning from here.
        token = scanner.reScanTemplateToken(false);
        if (token === ts.SyntaxKind.TemplateTail) {
          templateSubstitutionDepths.pop();
        }
        // token is now TemplateMiddle (another `${` follows) or TemplateTail
        // (the closing backtick) -- neither is a comment, so fall through to
        // the bottom of the loop and scan the token that follows it.
      } else {
        braceDepth--;
      }
    }
    token = scanner.scan();
  }
  return chars.join('');
}

/**
 * Load + comment-strip every production `.ts` file under `<repoRoot>/src`.
 */
export function collectProductionSourceFiles(repoRoot: string): ProductionSourceFile[] {
  const srcRoot = join(repoRoot, 'src');
  const absPaths: string[] = [];
  walk(srcRoot, absPaths);
  absPaths.sort();

  return absPaths.map((absPath) => {
    const rawText = readFileSync(absPath, 'utf-8');
    return {
      absPath,
      relPath: relative(repoRoot, absPath),
      rawText,
      liveCode: stripComments(rawText),
    };
  });
}

/** The repo root, resolved from this file's own location (`tests/support/`). */
export function repoRootFromTestSupport(): string {
  // tests/support/scan-production-src.ts -> repo root is two levels up.
  return join(__dirname, '..', '..');
}
