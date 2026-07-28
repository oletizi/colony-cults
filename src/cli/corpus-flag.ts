/**
 * The global `--corpus <id>` flag (T009, FR-003).
 *
 * WHY THIS IS AN EXTRACTION PASS AND NOT A `parseArgs` OPTION: `--corpus` is
 * GLOBAL — it may accompany any of the ~23 registered commands. Those commands
 * do not share one parser: `src/cli/parse.ts` parses the flat Gallica verbs,
 * `src/cli/bibliography.ts`'s `parseBibArgs` parses the SSOT subactions, and
 * several subactions (`inventory`, `discover`, `coverage`, `acquire`,
 * `query-source`, `rights-assess`, ...) each run their OWN
 * `node:util.parseArgs` with `strict: true` and a bespoke option set. A strict
 * parser REJECTS an option it does not declare, so adding `--corpus` to one
 * parser would make it a usage error under every other.
 *
 * The composition root therefore strips `--corpus <id>` from argv BEFORE
 * dispatch and hands the remaining argv to the existing parsers untouched.
 * Every downstream parser keeps its exact current option set (FR-010,
 * behavior-preserving), and the corpus selector is resolved exactly once, at
 * the root, from the value extracted here.
 */

const FLAG = '--corpus';
const FLAG_EQ = `${FLAG}=`;

/** Result of stripping the global `--corpus` flag out of an argv vector. */
export interface CorpusFlagExtraction {
  /**
   * The `--corpus` value, if the flag was present. `undefined` means the flag
   * was absent — NOT that a default applies; the composition root resolves
   * precedence (`--corpus` → `COLONY_CORPUS` → fail loud, FR-003).
   */
  readonly corpus?: string;
  /** argv with the flag (and its value) removed, in original order. */
  readonly rest: readonly string[];
}

function failFlag(message: string): never {
  throw new Error(`${FLAG}: ${message}`);
}

/**
 * Extract the global `--corpus <id>` / `--corpus=<id>` flag from `argv`.
 *
 * Fails loud (throws) rather than guessing on every malformed form:
 * - `--corpus` with no following token;
 * - `--corpus` followed by another option (`--corpus --json`), which would
 *   otherwise silently select a corpus named `--json`;
 * - an empty value (`--corpus=` or `--corpus ""`);
 * - the flag given more than once (even with the same value) — an ambiguous
 *   invocation is an operator error, not something to resolve by precedence.
 *
 * A bare `--` end-of-options sentinel stops the scan: everything after it is
 * passed through verbatim, so an operand that happens to look like the flag is
 * never eaten.
 */
export function extractCorpusFlag(argv: readonly string[]): CorpusFlagExtraction {
  const rest: string[] = [];
  let corpus: string | undefined;

  const assign = (value: string, form: string): void => {
    if (corpus !== undefined) {
      failFlag(`given more than once (${JSON.stringify(corpus)} then ${JSON.stringify(value)}) — pass it exactly once`);
    }
    if (value.length === 0) {
      failFlag(`empty corpus id in ${form} — pass a corpus id, e.g. ${FLAG} port-breton`);
    }
    corpus = value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      rest.push(...argv.slice(index));
      return { corpus, rest };
    }

    if (arg === FLAG) {
      const value = argv[index + 1];
      if (value === undefined) {
        failFlag(`requires a corpus id, e.g. ${FLAG} port-breton`);
      }
      if (value.startsWith('-')) {
        failFlag(
          `requires a corpus id, but was followed by ${JSON.stringify(value)} — ` +
            `e.g. ${FLAG} port-breton`,
        );
      }
      assign(value, `${FLAG} ${JSON.stringify(value)}`);
      index += 1;
      continue;
    }

    if (arg.startsWith(FLAG_EQ)) {
      assign(arg.slice(FLAG_EQ.length), arg);
      continue;
    }

    rest.push(arg);
  }

  return { corpus, rest };
}
