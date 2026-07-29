import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Corpus config seam — THE CORPUS-ID GRAMMAR AND THE ROOT-CONTAINMENT GUARD
 * (AUDIT-29).
 *
 * A corpus id is a NAME, not a path. It names one file directly inside the
 * INJECTED corpora root (`<corporaRoot>/<id>.yml`, and the profile beside it
 * at `<corporaRoot>/<id>.browser.yml`). Both loaders used to build that path
 * by pasting the id straight into `join()` BEFORE validating anything, so an
 * id carrying `..` or a path separator read a file the injected root does not
 * contain.
 *
 * WHY THAT MATTERED RATHER THAN BEING MERELY UNTIDY. The id reaching those
 * loaders is operator input: `--corpus <id>` and `COLONY_CORPUS=<id>` flow
 * through `@/corpus/select`'s `selectCorpus` unfiltered. So
 * `bib --corpus ../outside <verb>` composed REAL narrow policies — declared
 * cases, the allocatable id namespace, required capabilities, archive-layout
 * overrides — from a manifest outside the root. And because
 * `listCorpusManifestIds` enumerates only files sitting DIRECTLY in the root,
 * `bib validate-config` never saw that manifest: FR-015's strict policy
 * ("every committed manifest must be valid before any corpus can run") cannot
 * bind an artifact it cannot enumerate. An out-of-root corpus was therefore
 * both runnable and unvalidatable.
 *
 * TWO CHECKS, DELIBERATELY BOTH:
 *
 *   1. {@link assertCorpusId} — the GRAMMAR, checked first so the operator
 *      gets a message about the id rather than about a missing file.
 *   2. {@link corpusArtifactPath} — a CONTAINMENT assertion on the resolved
 *      path. The grammar already forbids every separator, so this is
 *      unreachable via the grammar; it is kept as a structural backstop so
 *      that any future loosening of the grammar cannot silently reopen the
 *      escape. Cheap, and the property it defends ("the file is IN the
 *      injected root") is the one that actually matters.
 */

/**
 * `^[a-z0-9][a-z0-9-]*$` — the same lowercase-kebab shape the manifest loader
 * already requires of CASE ids, applied to the corpus id that names the file.
 *
 * Every committed and fixture manifest already conforms. Note what the
 * grammar excludes by construction: `/`, `\`, `.` (so no `..` and no
 * extension smuggling), `:` (so no Windows drive letter), whitespace, and the
 * empty string.
 */
const CORPUS_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Reject any id that is not a bare corpus name, naming the id, the caller,
 * and the grammar.
 *
 * `where` is the calling function's name so the message locates the failure
 * the way the loaders' own `fail()` helpers do.
 */
export function assertCorpusId(id: string, where: string): void {
  if (CORPUS_ID_PATTERN.test(id)) {
    return;
  }
  throw new Error(
    `${where}: corpus id ${JSON.stringify(id)} is not a valid corpus id — it must match ` +
      `${CORPUS_ID_PATTERN} (lowercase letters, digits and hyphens). A corpus id NAMES a file ` +
      'directly inside the injected corpora root; it is never a path, so path separators, "." ' +
      'and ".." are rejected outright rather than resolved (an id resolving outside the root ' +
      'would yield a corpus that runs but that `bib validate-config` cannot enumerate).',
  );
}

/**
 * The path of one corpus artifact — `<corporaRoot>/<id><suffix>` — with the
 * grammar checked first and containment within `corporaRoot` asserted after.
 *
 * This is the ONLY way `@/corpus/manifest` and `@/corpus/browser-profile` are
 * permitted to turn an id into a path.
 */
export function corpusArtifactPath(
  corporaRoot: string,
  id: string,
  suffix: string,
  where: string,
): string {
  assertCorpusId(id, where);

  const filePath = join(corporaRoot, `${id}${suffix}`);
  const resolvedRoot = resolve(corporaRoot);
  const resolvedDir = dirname(resolve(filePath));
  if (isAbsolute(id) || resolvedDir !== resolvedRoot) {
    throw new Error(
      `${where}: corpus id ${JSON.stringify(id)} resolves to ${JSON.stringify(resolve(filePath))}, ` +
        `which is not directly inside the injected corpora root ${JSON.stringify(resolvedRoot)}`,
    );
  }

  return filePath;
}
