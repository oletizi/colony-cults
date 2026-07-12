/**
 * Object-store key builders and the CDN URL builder for the publish
 * pipeline. Pure functions only -- no I/O, no filesystem, no network. The
 * one exception is {@link resolveCdnBase}, which is deliberately isolated
 * so the env read lives in a single, narrow place while the builders
 * ({@link versionedKey}, {@link legacyFlatKey}, {@link cdnUrl}) stay
 * trivially unit-testable without mocking `process.env`.
 *
 * See specs/008-edition-publishing/data-model.md §2 (Publication),
 * §4 (PublishedArtifact key schemes), contracts/ssot-publications.md
 * (key/url invariants), and research.md Decision 2 (versioned key scheme
 * and canonical CDN URL).
 */

/** Which edition variant was published (FR-012). Mirrors `Publication.variant` (`@/model/publication`). */
export type PublicationVariant = 'parallel' | 'english-only';

/**
 * Builds the versioned object-store key for a newly published issue
 * (`keyScheme: 'versioned'`, data-model.md §4):
 *
 * `editions/<variant>/<sourceId>/<issueId>__<snapshotShort>.pdf`
 *
 * The `<snapshotShort>` ties the key to the reproducible corpus version: a
 * changed rebuild yields a new `snapshotShort` -- and therefore a new key --
 * rather than overwriting the old one (FR-003/FR-009), so no CDN purge is
 * ever required (research.md Decision 2).
 */
export function versionedKey(
  variant: PublicationVariant,
  sourceId: string,
  issueId: string,
  snapshotShort: string,
): string {
  return `editions/${variant}/${sourceId}/${issueId}__${snapshotShort}.pdf`;
}

/**
 * Builds the legacy-flat object-store key (`keyScheme: 'legacy-flat'`,
 * data-model.md §4) for the reconciled 72 PB-P001 issues, recorded at their
 * existing served keys (no re-upload, no `__snapshotShort` suffix):
 *
 * `editions/english-only/<sourceId>/<issueId>.pdf`
 *
 * This scheme is english-only only (research.md Decision 2); there is no
 * legacy-flat key for the `parallel` variant.
 */
export function legacyFlatKey(sourceId: string, issueId: string): string {
  return `editions/english-only/${sourceId}/${issueId}.pdf`;
}

/**
 * Composes the canonical public CDN URL for `key`, `${cdnBase}/${key}`
 * (data-model.md §3/§4 invariant: `url === cdnBase + '/' + key`), mirroring
 * the normalization in `src/browser/providers/b2-cdn.ts`'s
 * `makeB2CdnProvider`: strips a trailing slash from `cdnBase` and a leading
 * slash from `key` so there is exactly one slash between them, however
 * either argument is formatted. Pure -- does not read env; see
 * {@link resolveCdnBase} for that.
 */
export function cdnUrl(cdnBase: string, key: string): string {
  const base = cdnBase.replace(/\/+$/, '');
  const normalizedKey = key.replace(/^\/+/, '');
  return `${base}/${normalizedKey}`;
}

/**
 * Resolves the CDN base from the environment (`CORPUS_CDN_BASE`), the same
 * variable `src/pdf/render/build.ts`'s `makeImageSource` and
 * `src/browser/config.ts` require for the `b2`/`b2-cdn` providers, and the
 * one `infra/cloudflare-cdn/README.md` documents as the Worker origin reads
 * resolve `${CORPUS_CDN_BASE}/<key>` against.
 *
 * Fail-loud: throws a descriptive `Error` if unset or blank rather than
 * inventing a fallback base (Principle III), matching `build.ts`'s
 * treatment of the same variable. Keeping the env read confined to this one
 * function is what lets {@link versionedKey}, {@link legacyFlatKey}, and
 * {@link cdnUrl} stay pure and directly unit-testable.
 *
 * @param env defaults to `process.env`; inject a fake env object in tests.
 */
export function resolveCdnBase(env: NodeJS.ProcessEnv = process.env): string {
  const cdnBase = env.CORPUS_CDN_BASE?.trim();
  if (!cdnBase) {
    throw new Error(
      'resolveCdnBase: CORPUS_CDN_BASE (the public CDN base fronting the object store, e.g. ' +
        'https://colony-cults-cdn.oletizi.workers.dev) is not set. Publishing requires a ' +
        'canonical CDN base to record on Publication.cdnBase and derive issue URLs -- there ' +
        'is no fallback.',
    );
  }
  return cdnBase;
}
