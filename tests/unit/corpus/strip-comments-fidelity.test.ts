import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';

import {
  collectProductionSourceFiles,
  repoRootFromTestSupport,
  stripComments,
} from '../../support/scan-production-src';

/**
 * THE TEETH-CHECK FOR THE TEETH-CHECK (AUDIT-12).
 *
 * `no-legacy-constants-guard` and `spec2-field-guard` both decide whether a
 * forbidden name appears in LIVE code by scanning `stripComments(rawText)`.
 * If `stripComments` desyncs, those guards go GREEN WHILE BLIND: real code is
 * blanked out (a forbidden constant would no longer be seen) or real comments
 * survive (prose that merely MENTIONS a retired name reads as live code). The
 * first failure mode is silent and is the one AUDIT-12 found live: a regex
 * literal such as `/^ark:\/12148\//` made the hand-rolled scan read `\` then
 * `//` as a line comment and blank the rest of the line, and a quote inside
 * `/[",\n\r]/` desynced ~200 lines of `src/bibliography/regenerate.ts`.
 *
 * So this test does not trust the scanner: it recomputes the comment spans
 * INDEPENDENTLY from `ts.createSourceFile`'s parse tree (every comment in a
 * file is leading trivia of exactly one token, including the EOF token) and
 * asserts, character by character across every production file, that
 * `stripComments` blanked exactly those spans and nothing else.
 *
 * Two distinct assertions, because they fail for opposite reasons:
 *   - NO LIVE CODE BLANKED  -> a blind guard (false negative). This is the
 *     dangerous one.
 *   - NO COMMENT SURVIVING  -> a guard that trips on prose (false positive).
 */

/**
 * Every character offset belonging to a comment, per the TS parser itself.
 *
 * BOTH range kinds are needed. `getLeadingCommentRanges` deliberately stops
 * collecting until the first newline, so a comment sitting on the SAME line as
 * the preceding code (`accessKeyId: string; // never log`) is classified as a
 * TRAILING comment of the previous token and is invisible to the leading
 * query. Asking only for leading ranges would therefore under-report comments
 * and make this test accuse a correct `stripComments` of blanking live code.
 */
function groundTruthCommentIndices(text: string): Set<number> {
  const sourceFile = ts.createSourceFile(
    'ground-truth.ts',
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const indices = new Set<number>();
  const visitedStarts = new Set<number>();
  const visitedEnds = new Set<number>();

  const add = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      for (let i = range.pos; i < range.end; i++) {
        indices.add(i);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    // A node's `pos` is its FULL start (before leading trivia); node and
    // first-child share a `pos`, hence the dedupe.
    if (!visitedStarts.has(node.pos)) {
      visitedStarts.add(node.pos);
      add(ts.getLeadingCommentRanges(text, node.pos));
    }
    if (!visitedEnds.has(node.end)) {
      visitedEnds.add(node.end);
      add(ts.getTrailingCommentRanges(text, node.end));
    }
    for (const child of node.getChildren(sourceFile)) {
      visit(child);
    }
  };

  visit(sourceFile);
  return indices;
}

interface FidelityMismatch {
  readonly relPath: string;
  readonly line: number;
  readonly detail: string;
}

/** Human-readable 1-based line number of a character offset. */
function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
    }
  }
  return line;
}

const files = collectProductionSourceFiles(repoRootFromTestSupport());

/** Both mismatch classes, computed once for the whole production tree. */
function scanFidelity(): {
  readonly liveCodeBlanked: FidelityMismatch[];
  readonly commentSurvived: FidelityMismatch[];
} {
  const liveCodeBlanked: FidelityMismatch[] = [];
  const commentSurvived: FidelityMismatch[] = [];

  for (const file of files) {
    const truth = groundTruthCommentIndices(file.rawText);
    const stripped = stripComments(file.rawText);
    // One report per file per class -- 27 mismatched characters on one line
    // is one defect, not 27.
    let reportedBlank = false;
    let reportedSurvivor = false;

    for (let i = 0; i < file.rawText.length; i++) {
      const raw = file.rawText[i];
      const out = stripped[i];
      if (raw === undefined || out === undefined) {
        continue;
      }
      const isComment = truth.has(i);
      if (!isComment && out !== raw && !reportedBlank) {
        reportedBlank = true;
        liveCodeBlanked.push({
          relPath: file.relPath,
          line: lineOf(file.rawText, i),
          detail: `live character ${JSON.stringify(raw)} was blanked to ${JSON.stringify(out)}`,
        });
      }
      const alreadyBlank = raw === ' ' || raw === '\n' || raw === '\r';
      if (isComment && !alreadyBlank && out === raw && !reportedSurvivor) {
        reportedSurvivor = true;
        commentSurvived.push({
          relPath: file.relPath,
          line: lineOf(file.rawText, i),
          detail: `comment character ${JSON.stringify(raw)} survived un-blanked`,
        });
      }
    }
  }

  return { liveCodeBlanked, commentSurvived };
}

describe('stripComments fidelity vs the TypeScript parser (AUDIT-12)', () => {
  it('finds production source to scan at all', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('never blanks live code -- the false-negative that makes the guards blind', () => {
    const { liveCodeBlanked } = scanFidelity();
    expect(
      liveCodeBlanked.map((m) => `${m.relPath}:${m.line} -- ${m.detail}`),
    ).toEqual([]);
  });

  it('never leaves a comment un-blanked -- the false-positive that trips on prose', () => {
    const { commentSurvived } = scanFidelity();
    expect(
      commentSurvived.map((m) => `${m.relPath}:${m.line} -- ${m.detail}`),
    ).toEqual([]);
  });
});
