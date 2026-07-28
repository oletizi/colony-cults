import { assertKnownKeys, fail, isPlainObject } from '@/corpus/manifest-primitives';

/**
 * Corpus config seam — the `sourceIds` field of a corpus manifest (FR-002b,
 * INV-15). See specs/018-corpus-config-seam/spec.md § FR-002b and
 * data-model.md § CorpusManifest.
 *
 * WHY A LIST AND NOT ONE POLICY
 *
 * The seam was first built assuming one corpus == one source-ID namespace.
 * That assumption is false against the shipped SSOT: `bibliography/sources/`
 * holds 92 `PB-P###` primary sources (machine-allocated by
 * `@/sourcegroup/id-alloc`) alongside 2 hand-authored secondary scholarly
 * works, `PB-S001` and `PB-S002` — and all 94 declare `case: port-breton`,
 * i.e. ONE corpus carrying TWO namespaces. A singular policy would make the
 * real `corpora/port-breton.yml` fail strict validation (FR-015) and, under
 * that policy, block every corpus. So `sourceIds` is a non-empty LIST.
 *
 * EXACTLY ONE ALLOCATABLE POLICY
 *
 * A Source CONFORMS if it matches any of its corpus's policies, but a new ID
 * is ALLOCATED from exactly one of them. Zero allocatable policies leaves the
 * allocator with no target; two or more leaves it with an ambiguous one.
 * Both are rejected here rather than resolved by a precedence rule, because
 * any precedence rule would be an invented convention silently deciding where
 * the next 93rd Source lands. The narrow `SourceIdPolicy` injected into
 * `@/sourcegroup/id-alloc` stays SINGULAR and is derived from this one entry,
 * so the allocation seam itself is unchanged.
 *
 * Within-corpus and cross-corpus prefix disjointness are deliberately NOT
 * checked here: disjointness is a property of the whole repository's policy
 * set (FR-002a), and lives in `@/corpus/validate-repository`, which compares
 * every policy of every corpus against every other — including a corpus's own
 * two prefixes. Implementing a partial copy here would let the two drift.
 */

/**
 * One `sourceIds` policy: a namespace this corpus's Source IDs may sit in.
 */
export interface CorpusSourceIdPolicy {
  /**
   * The literal prefix every Source ID in this namespace starts with.
   * Grammar: `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$` — no trailing delimiter is
   * required, e.g. the shipped Port Breton prefixes `PB-P` and `PB-S` are
   * both valid.
   */
  prefix: string;
  /** Zero-pad width for the numeric suffix. `1 <= padWidth <= 8`. */
  padWidth: number;
  /**
   * Whether new Source IDs are allocated into this namespace. EXACTLY ONE
   * policy per corpus carries `true` (FR-002b); the others are conformance-
   * only namespaces for hand-authored records.
   */
  allocatable: boolean;
}

const SOURCE_ID_POLICY_KEYS = new Set(['prefix', 'padWidth', 'allocatable']);

/**
 * `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$` (contracts/corpus-seam.md, FR-002a).
 * No trailing delimiter is required -- the shipped Port Breton prefix `PB-P`
 * is valid. Namespace disjointness (no configured prefix equal to, or a
 * leading substring of, another, across ALL policies of ALL corpora) is a
 * repository-wide check enforced by `@/corpus/validate-repository`, not here.
 */
const SOURCE_PREFIX_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

function validateOnePolicy(value: unknown, filePath: string, where: string): CorpusSourceIdPolicy {
  if (!isPlainObject(value)) {
    fail(filePath, `${where} must be an object with "prefix", "padWidth" and "allocatable"`);
  }
  assertKnownKeys(value, SOURCE_ID_POLICY_KEYS, filePath, where);

  const prefix = value.prefix;
  if (typeof prefix !== 'string' || !SOURCE_PREFIX_PATTERN.test(prefix)) {
    fail(
      filePath,
      `${where}.prefix ${JSON.stringify(prefix)} must match ${SOURCE_PREFIX_PATTERN} (an uppercase-alphanumeric prefix, optionally hyphen-delimited)`,
    );
  }

  const padWidth = value.padWidth;
  if (typeof padWidth !== 'number' || !Number.isInteger(padWidth) || padWidth < 1 || padWidth > 8) {
    fail(
      filePath,
      `${where}.padWidth ${JSON.stringify(padWidth)} must be an integer between 1 and 8 inclusive`,
    );
  }

  const allocatable = value.allocatable;
  if (typeof allocatable !== 'boolean') {
    fail(
      filePath,
      `${where}.allocatable ${JSON.stringify(allocatable)} must be a boolean; exactly one policy per corpus must be \`true\` (FR-002b)`,
    );
  }

  return { prefix, padWidth, allocatable };
}

/**
 * Validate the whole `sourceIds` list: non-empty, every entry structurally
 * valid, and EXACTLY ONE entry with `allocatable: true` (INV-15).
 */
export function validateSourceIdPolicies(
  value: unknown,
  filePath: string,
): CorpusSourceIdPolicy[] {
  if (!Array.isArray(value)) {
    fail(
      filePath,
      '"sourceIds" must be a non-empty list of { prefix, padWidth, allocatable } policies ' +
        '(FR-002b); a single object is the retired schema shape',
    );
  }

  if (value.length === 0) {
    fail(
      filePath,
      '"sourceIds" must declare at least one ID policy; an empty list leaves the corpus with ' +
        'no source-ID namespace at all (FR-002b)',
    );
  }

  const policies = value.map((entry, index) =>
    validateOnePolicy(entry, filePath, `"sourceIds[${index}]"`),
  );

  const allocatable = policies.filter((policy) => policy.allocatable);
  if (allocatable.length !== 1) {
    const declared = policies.map((policy) => JSON.stringify(policy.prefix)).join(', ');
    const marked =
      allocatable.length === 0
        ? '(none)'
        : allocatable.map((policy) => JSON.stringify(policy.prefix)).join(', ');
    fail(
      filePath,
      `"sourceIds" declares ${allocatable.length} policies with "allocatable: true" ` +
        `(${marked}); EXACTLY ONE must be allocatable — the source-ID allocator needs one ` +
        `unambiguous target (FR-002b). Declared prefixes: ${declared}`,
    );
  }

  return policies;
}
