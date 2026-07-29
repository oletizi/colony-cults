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

/** True for a scanner token that is trivia (whitespace / newline / comment / shebang). */
function isTriviaToken(token: ts.SyntaxKind): boolean {
  return token >= ts.SyntaxKind.FirstTriviaToken && token <= ts.SyntaxKind.LastTriviaToken;
}

/**
 * Whether a `/` following `previous` starts a REGEX LITERAL rather than being
 * a division operator -- the ambiguity `ts.createScanner` cannot resolve on
 * its own (it emits `SlashToken` and waits for the parser to ask for a
 * re-scan via `reScanSlashToken()`).
 *
 * The rule is the standard one: `/` is division only after a token that can
 * END an expression -- an identifier, a literal, a closing bracket/paren/brace,
 * a postfix `++`/`--`, or one of the value keywords. After ANY other token
 * (an operator, a comma, an open paren, `return`, `typeof`, `=>`, the start of
 * the file, ...) an expression is expected, so `/` opens a regex.
 *
 * `}` is listed as division-context because the far more common `}` in this
 * codebase closes an object literal; a regex opening a statement immediately
 * after a block `}` does not occur here, and the
 * `strip-comments-fidelity` test proves character-for-character that this
 * classification matches the TypeScript parser across the whole `src/` tree.
 */
function slashStartsRegex(previous: ts.SyntaxKind | undefined): boolean {
  if (previous === undefined) {
    return true;
  }
  switch (previous) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateTail:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.CloseParenToken:
    case ts.SyntaxKind.CloseBracketToken:
    case ts.SyntaxKind.CloseBraceToken:
    case ts.SyntaxKind.PlusPlusToken:
    case ts.SyntaxKind.MinusMinusToken:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.SuperKeyword:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return false;
    default:
      return true;
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

  // The SECOND thing plain `scanner.scan()` cannot do on its own (AUDIT-12):
  // tell a REGEX LITERAL from a division `/`. It emits `SlashToken` and waits
  // for `reScanSlashToken()`. Without that, `/^ark:\/12148\//` scans as a
  // slash, a backslash, then `//` -- read as a LINE COMMENT, blanking the rest
  // of a line of live code; and the `"` inside `/[",\n\r]/` opens a phantom
  // string that swallows ~200 lines. Both make the constant guards go GREEN
  // WHILE BLIND. Resolving the ambiguity needs the previous non-trivia token,
  // tracked here -- see {@link slashStartsRegex}.
  let previousToken: ts.SyntaxKind | undefined;

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
    } else if (
      (token === ts.SyntaxKind.SlashToken ||
        token === ts.SyntaxKind.SlashEqualsToken) &&
      slashStartsRegex(previousToken)
    ) {
      // `reScanSlashToken` re-reads from the `/` as a regex literal, consuming
      // the whole literal (character class, escapes and all) as ONE token, so
      // nothing inside it can be mistaken for a comment or a string opener. It
      // returns the original token unchanged if no regex can be scanned there.
      token = scanner.reScanSlashToken();
    }
    if (!isTriviaToken(token)) {
      previousToken = token;
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
