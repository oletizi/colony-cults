/**
 * Loader companions for the specs/008 edition-publishing SSOT fields
 * `Source.rights` and `Source.publications[]`, extended by spec
 * 015-english-source-pdf's `ocrTranscription` disclosure. Extracted from
 * `load.ts` (Constitution VII, <=500 lines), mirroring the `load-fields.ts` /
 * `load-coverage-fields.ts` / `load-publication-fields.ts` companion-module
 * pattern. `load.ts` calls {@link validateSourceRights} and
 * {@link validatePublication} directly; everything else here is a private
 * helper.
 */

import {
  assertKnownKeys,
  fail,
  optionalString,
  requireNumber,
  requireObject,
  requireString,
} from '@/bibliography/load-primitives';
import {
  assertExactlyOneProvenanceDisclosure,
  validateOcrTranscription,
} from '@/bibliography/load-publication-fields';
import { isSourceRightsStatus } from '@/bibliography/vocab';
import type { MachineAssistLabel } from '@/pdf/model';
import type { Publication, PublicationManifestRef, SourceRights } from '@/model/publication';

// Closed nested-key allow-lists for the specs/008 publish fields, mirroring the
// per-nested-object `assertKnownKeys` discipline in `load-fields.ts`.
const SOURCE_RIGHTS_KEYS = new Set(['status', 'basis', 'determinedAt']);
const PUBLICATION_KEYS = new Set([
  'variant',
  'publishedAt',
  'snapshot',
  'snapshotShort',
  'cdnBase',
  'keyScheme',
  'rightsBasis',
  'machineAssist',
  'ocrTranscription',
  'manifest',
]);
const MACHINE_ASSIST_KEYS = new Set(['engine', 'model', 'retrieved']);
const PUBLICATION_MANIFEST_KEYS = new Set(['manifestPath', 'issueCount']);

function isPublicationVariant(value: string): value is Publication['variant'] {
  return value === 'parallel' || value === 'english-only';
}

function isKeyScheme(value: string): value is Publication['keyScheme'] {
  return value === 'versioned' || value === 'legacy-flat';
}

/**
 * Parse+validate the affirmative, work-level `rights` determination (specs/008,
 * FR-002/FR-005). `status` is narrowed against the closed `SourceRightsStatus`
 * vocab (`isSourceRightsStatus`) -- an unrecognized value fails loud, naming the
 * source file and the offending value. `basis` is a required non-empty
 * justification (recorded as `Publication.rightsBasis` on publish);
 * `determinedAt` is an optional ISO date. This is the loader's STRUCTURAL check
 * only -- the publish gate's affirmative-distributable decision (only
 * `public-domain` clears today; T023) is not made here.
 */
export function validateSourceRights(value: unknown, filePath: string): SourceRights {
  const where = 'rights';
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, SOURCE_RIGHTS_KEYS, filePath, where);
  const statusRaw = requireString(obj.status, filePath, `${where}.status`);
  if (!isSourceRightsStatus(statusRaw)) {
    fail(
      filePath,
      `${where}.status "${statusRaw}" is not in the closed SourceRights status ` +
        `vocabulary (public-domain / openly-licensed / gov-reusable)`,
    );
  }
  const basis = requireString(obj.basis, filePath, `${where}.basis`);
  const determinedAt = optionalString(obj.determinedAt, filePath, `${where}.determinedAt`);
  return determinedAt === undefined
    ? { status: statusRaw, basis }
    : { status: statusRaw, basis, determinedAt };
}

/**
 * Parse one publication's `machineAssist` label (specs/008). Modeled optional
 * on `Publication`; REQUIRED for a French publication, recorded INSTEAD OF
 * `ocrTranscription` (`@/bibliography/load-publication-fields`) for an
 * English-source one (spec 015 FR-008/FR-013). `engine` + `retrieved` are
 * required non-empty strings; `model` is a recorded id or `null`.
 */
function validateMachineAssist(
  value: unknown,
  filePath: string,
  where: string,
): MachineAssistLabel {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, MACHINE_ASSIST_KEYS, filePath, where);
  const engine = requireString(obj.engine, filePath, `${where}.engine`);
  const retrieved = requireString(obj.retrieved, filePath, `${where}.retrieved`);
  const model =
    obj.model === undefined || obj.model === null
      ? null
      : requireString(obj.model, filePath, `${where}.model`);
  return { engine, model, retrieved };
}

/**
 * Parse a publication's lean `manifest` reference (specs/008 FR-006) -- the
 * pointer to the per-issue integrity file whose contents live outside the source
 * YAML. `manifestPath` is a required non-empty repo-relative path; `issueCount`
 * is the derived published-issue count.
 */
function validatePublicationManifestRef(
  value: unknown,
  filePath: string,
  where: string,
): PublicationManifestRef {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, PUBLICATION_MANIFEST_KEYS, filePath, where);
  const manifestPath = requireString(obj.manifestPath, filePath, `${where}.manifestPath`);
  const issueCount = requireNumber(obj.issueCount, filePath, `${where}.issueCount`);
  return { manifestPath, issueCount };
}

/**
 * Enforce the variant x disclosure cross-check (AUDIT-20260719-07): `variant:
 * "parallel"` is inherently a French-OCR / English-translation edition, so it
 * MUST carry `machineAssist` and MUST NOT carry `ocrTranscription`. Reject
 * only that one contradiction -- `variant: "english-only"` is deliberately
 * AMBIGUOUS and valid with EITHER disclosure (a French source rendered
 * english-only carries `machineAssist`; an English OCR source carries
 * `ocrTranscription`), so it is never rejected here. Called AFTER
 * `assertExactlyOneProvenanceDisclosure`, so `parallel` with no `machineAssist`
 * is already covered (exactly-one guarantees the "neither" and "both" cases
 * are rejected; the only remaining contradiction is `parallel` +
 * `ocrTranscription`, which implies `parallel` + no `machineAssist`).
 */
function assertVariantMatchesDisclosure(publication: Publication, filePath: string, where: string): void {
  if (publication.variant === 'parallel' && publication.ocrTranscription !== undefined) {
    fail(
      filePath,
      `${where}: variant "parallel" carries an ocrTranscription disclosure -- "parallel" is ` +
        `inherently a French-OCR / English-translation edition and must carry machineAssist ` +
        `instead; refusing to load a publication whose variant and provenance disclosure ` +
        `contradict each other.`,
    );
  }
}

/**
 * Parse one authored `publications[]` entry (specs/008 § 2; `machineAssist` /
 * `ocrTranscription` extended by spec 015 FR-008/FR-013). Any malformed shape
 * fails loud, including the ENFORCED exactly-one-disclosure invariant: a
 * publication must carry `machineAssist` XOR `ocrTranscription`, never both
 * and never neither (`assertExactlyOneProvenanceDisclosure`,
 * AUDIT-20260719-03/04) -- this loader is its own enforcement boundary, not a
 * deferral to `buildPublication` -- AND the variant x disclosure cross-check
 * (`assertVariantMatchesDisclosure`, AUDIT-20260719-07): `parallel` requires
 * `machineAssist` and forbids `ocrTranscription`; `english-only` is valid
 * with either.
 */
export function validatePublication(value: unknown, filePath: string, index: number): Publication {
  const where = `publications[${index}]`;
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, PUBLICATION_KEYS, filePath, where);

  const variantRaw = requireString(obj.variant, filePath, `${where}.variant`);
  if (!isPublicationVariant(variantRaw)) {
    fail(filePath, `${where}.variant "${variantRaw}" must be "parallel" or "english-only"`);
  }
  const publishedAt = requireString(obj.publishedAt, filePath, `${where}.publishedAt`);
  const snapshot = requireString(obj.snapshot, filePath, `${where}.snapshot`);
  const snapshotShort = requireString(obj.snapshotShort, filePath, `${where}.snapshotShort`);
  const cdnBase = requireString(obj.cdnBase, filePath, `${where}.cdnBase`);
  const keySchemeRaw = requireString(obj.keyScheme, filePath, `${where}.keyScheme`);
  if (!isKeyScheme(keySchemeRaw)) {
    fail(filePath, `${where}.keyScheme "${keySchemeRaw}" must be "versioned" or "legacy-flat"`);
  }
  const rightsBasis = requireString(obj.rightsBasis, filePath, `${where}.rightsBasis`);
  const manifest = validatePublicationManifestRef(obj.manifest, filePath, `${where}.manifest`);

  const publication: Publication = {
    variant: variantRaw,
    publishedAt,
    snapshot,
    snapshotShort,
    cdnBase,
    keyScheme: keySchemeRaw,
    rightsBasis,
    manifest,
  };
  if (obj.machineAssist !== undefined) {
    publication.machineAssist = validateMachineAssist(
      obj.machineAssist,
      filePath,
      `${where}.machineAssist`,
    );
  }
  if (obj.ocrTranscription !== undefined) {
    const ocrWhere = `${where}.ocrTranscription`;
    publication.ocrTranscription = validateOcrTranscription(obj.ocrTranscription, filePath, ocrWhere);
  }
  assertExactlyOneProvenanceDisclosure(
    publication.machineAssist,
    publication.ocrTranscription,
    filePath,
    where,
  );
  assertVariantMatchesDisclosure(publication, filePath, where);
  return publication;
}
