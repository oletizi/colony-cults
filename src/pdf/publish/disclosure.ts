/**
 * The per-issue provenance-disclosure carried across a multi-issue publish
 * run (spec 015-english-source-pdf; AUDIT-20260719-06) -- EITHER a French
 * `machineAssist` translation label OR an English `ocrTranscription`
 * disclosure, each optional so "not yet seen" is representable pre-loop.
 * Extracted from `modes.ts` (Constitution VII, <=500 lines), mirroring the
 * `load-fields.ts` / `load-publication-fields.ts` companion-module pattern.
 */

import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';
import type { PublishOptions } from '@/pdf/publish/types';

/** The running (or per-issue) provenance disclosure; each field independently optional. */
export interface Disclosure {
  machineAssist?: MachineAssistLabel;
  ocrTranscription?: OcrTranscription;
}

/**
 * Merge one issue's disclosure `outcome` into the running `current` one,
 * identified by `issueId` for the locating error message.
 *
 * Before AUDIT-20260719-06 this was first-seen-wins: a later issue's
 * DIFFERENT disclosure (e.g. a worse OCR caveat surfaced only by a later
 * issue) was silently dropped, understating OCR quality on the durable
 * `Publication` record. This now FAILS LOUD when two issues in the same
 * publish run carry DIFFERENT values for the same disclosure field.
 *
 * Chosen over computing an explicit edition-level "worst" aggregate for two
 * reasons: (1) it requires no new ordinal ranking over free-text `caveat`
 * strings -- the existing worst-tier aggregation already happens ONE LEVEL
 * DOWN, per-edition, in `deriveOcrCaveat`/`buildOcrTranscription`
 * (`@/pdf/load/archive-edition`, AUDIT-20260719-01); inventing a second,
 * cross-issue aggregation here would duplicate that logic outside its home
 * and risk the two disagreeing. (2) A genuine disclosure mismatch across
 * issues published together in one run is itself an anomaly (most likely a
 * generation-time bug, e.g. issues built from inconsistent inputs) that
 * deserves a human's attention, not a silently computed answer -- so the
 * WHOLE publish run is refused rather than partially recorded (fail loud, no
 * fallback).
 *
 * A mismatch across the TWO disclosure KINDS (one issue carries
 * `machineAssist`, another carries `ocrTranscription` -- a mixed batch of
 * French- and English-source issues) is a different bug and is left to
 * surface via `buildPublication`'s exactly-one check on the merged result:
 * once both fields end up populated on the running `Disclosure`,
 * `buildPublication` rejects it.
 */
export function mergeDisclosure(current: Disclosure, outcome: Disclosure, issueId: string): Disclosure {
  return {
    machineAssist: mergeField(current.machineAssist, outcome.machineAssist, 'machineAssist', issueId),
    ocrTranscription: mergeField(
      current.ocrTranscription,
      outcome.ocrTranscription,
      'ocrTranscription',
      issueId,
    ),
  };
}

/** Merge one disclosure field, throwing (locating) if it conflicts with an earlier issue's value. */
function mergeField<T>(
  current: T | undefined,
  next: T | undefined,
  fieldName: string,
  issueId: string,
): T | undefined {
  if (next === undefined) {
    return current;
  }
  if (current === undefined) {
    return next;
  }
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    throw new Error(
      `mergeDisclosure: issue "${issueId}" carries a ${fieldName} disclosure that ` +
        `differs from an earlier issue in this publish run ` +
        `(earlier: ${JSON.stringify(current)}, this issue: ${JSON.stringify(next)}) -- ` +
        `refusing to silently collapse to first-seen (AUDIT-20260719-06); every ` +
        `issue recorded on one Publication must carry the SAME provenance disclosure.`,
    );
  }
  return current;
}

/**
 * Fold the `opts.machineAssist` run-option OVERRIDE onto a running disclosure
 * already built purely from per-issue outcomes (AUDIT-20260719-08).
 *
 * Before this fix, both `modes.ts` mode runners unconditionally SEEDED the
 * running disclosure with `{ machineAssist: opts.machineAssist }` BEFORE the
 * loop. For an English-source run every issue's `readIssueBuildInfo` outcome
 * correctly carries `ocrTranscription` (never `machineAssist`), but the
 * unconditional seed injected a `machineAssist` value from the run option
 * regardless -- `mergeDisclosure` then folded the issues' `ocrTranscription`
 * onto that seed, producing a running disclosure with BOTH fields populated,
 * which `buildPublication`'s exactly-one check rejected. The option's own
 * safety therefore depended entirely on `opts.machineAssist` happening to be
 * `undefined` for every English run -- a guarantee that lived outside this
 * module and was asserted nowhere near the seed.
 *
 * The fix: build the running disclosure PURELY from the per-issue outcomes
 * (each already exactly-one, enforced by `readIssueBuildInfo`), then apply
 * `opts.machineAssist` ONLY as a kind-aware fallback -- and ONLY once the
 * loop's real evidence is known:
 *  - an English run (`disclosure.ocrTranscription !== undefined`): the
 *    option is IGNORED outright, no matter its value -- an English run's
 *    provenance disclosure is never a translation label.
 *  - anything else: fold it in via `mergeDisclosure`, so a genuine conflict
 *    with an already-populated per-issue `machineAssist` still fails loud
 *    (same fail-loud-on-mismatch semantics `mergeDisclosure` already gives
 *    cross-issue), while an ABSENT per-issue `machineAssist` picks up the
 *    option as intended.
 *
 * Extracted here (not `modes.ts`) because it operates purely on `Disclosure`
 * + the one `PublishOptions` field it reads, mirroring `mergeDisclosure`'s
 * home; keeps `modes.ts` under the Constitution VII 500-line cap.
 */
export function applyMachineAssistOverride(
  disclosure: Disclosure,
  opts: Pick<PublishOptions, 'machineAssist'>,
  label: string,
): Disclosure {
  if (opts.machineAssist === undefined || disclosure.ocrTranscription !== undefined) {
    return disclosure;
  }
  return mergeDisclosure(disclosure, { machineAssist: opts.machineAssist }, label);
}
