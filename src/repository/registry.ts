/**
 * RepositoryAdapter registry -- pure selection layer over injected adapters.
 *
 * Owns NO concrete adapter (GallicaAdapter, NewItalyMuseumAdapter, ...): all
 * adapters are supplied to the constructor (composition, constructor DI).
 * The registry's only job is deterministic dispatch -- by a record's
 * copy-identifier type, or by an explicit repository name -- never by
 * sniffing a locator's shape/text.
 *
 * See specs/011-museum-acquisition-path/contracts/repository-adapter.md
 * INV-D.
 */

import type { RepositoryAdapter, RepositoryName } from '@/repository/adapter';
import type { CopyIdentifier, RepositoryRecord } from '@/model/repository-record';
import type { CopyLevelIdentifierType } from '@/model/identifiers';

/**
 * Explicit copy-identifier-type -> RepositoryName dispatch table (INV-D).
 * An identifier type absent from this table (e.g. `iiif-manifest`,
 * `scan-doi`) carries no dispatch weight -- it is simply not a signal
 * `selectForRecord` acts on, one way or the other.
 */
const IDENTIFIER_TYPE_REPOSITORY: Readonly<
  Partial<Record<CopyLevelIdentifierType, RepositoryName>>
> = {
  ark: 'gallica',
  accession: 'new-italy-museum',
};

/** Throw a locating, descriptive error naming the registry and the failure. */
function fail(message: string): never {
  throw new Error(`RepositoryAdapterRegistry: ${message}`);
}

/** A human-readable handle for a record in error messages. */
function recordLabel(record: RepositoryRecord): string {
  return `${record.sourceId} @ ${record.sourceArchive}`;
}

/** A human-readable summary of a record's identifier types, for error messages. */
function identifierTypesLabel(identifiers: readonly CopyIdentifier[]): string {
  if (identifiers.length === 0) {
    return 'none';
  }
  return identifiers.map((identifier) => identifier.type).join(', ');
}

/**
 * Selection layer over a fixed set of injected {@link RepositoryAdapter}s.
 *
 * `selectForRecord` decides FOR a single given record. When a caller holds
 * multiple eligible records and none has been explicitly chosen, resolving
 * that ambiguity (e.g. prompting the operator, or requiring `--repository`)
 * is the CALLER's concern -- the registry has no notion of a record set.
 */
export class RepositoryAdapterRegistry {
  private readonly adaptersByName: ReadonlyMap<RepositoryName, RepositoryAdapter>;

  /**
   * @param adapters The adapters to register. Fails loud on two adapters
   *   sharing the same `repository` name -- registration is meant to be an
   *   exhaustive, unambiguous set, never a "last one wins" map.
   */
  constructor(adapters: readonly RepositoryAdapter[]) {
    const map = new Map<RepositoryName, RepositoryAdapter>();
    for (const adapter of adapters) {
      if (map.has(adapter.repository)) {
        fail(
          `duplicate adapter registered for repository "${adapter.repository}" ` +
            '(each repository name must be registered exactly once)',
        );
      }
      map.set(adapter.repository, adapter);
    }
    this.adaptersByName = map;
  }

  /**
   * Look up a registered adapter by name, with a `context` phrase describing
   * why the lookup happened -- folded into the thrown message so a failure
   * always names both the missing repository and the caller's intent.
   */
  private lookup(name: RepositoryName, context: string): RepositoryAdapter {
    const adapter = this.adaptersByName.get(name);
    if (adapter === undefined) {
      fail(`no adapter registered for repository "${name}" (${context})`);
    }
    return adapter;
  }

  /**
   * Explicit selection by repository name, e.g. `inventory --repository`.
   *
   * @throws If no adapter is registered under `name`.
   */
  selectByName(name: RepositoryName): RepositoryAdapter {
    return this.lookup(name, 'requested explicitly by name');
  }

  /**
   * Deterministic dispatch for a single record, by its copy-identifier
   * type(s) (INV-D). `ark` dispatches to `gallica`; `accession` dispatches
   * to `new-italy-museum`; other identifier types carry no dispatch weight.
   *
   * @throws If the record has no supported copy identifier.
   * @throws If the record's identifiers map to more than one adapter
   *   (ambiguous -- e.g. both an `ark` and an `accession` identifier).
   * @throws If the single eligible repository has no registered adapter.
   */
  selectForRecord(record: RepositoryRecord): RepositoryAdapter {
    const identifiers = record.identifiers ?? [];
    const eligibleNames = new Set<RepositoryName>();

    for (const identifier of identifiers) {
      const name = IDENTIFIER_TYPE_REPOSITORY[identifier.type];
      if (name !== undefined) {
        eligibleNames.add(name);
      }
    }

    if (eligibleNames.size === 0) {
      fail(
        `record ${recordLabel(record)} has no supported copy identifier ` +
          `(dispatchable types: ${Object.keys(IDENTIFIER_TYPE_REPOSITORY).join(', ')}; ` +
          `found: ${identifierTypesLabel(identifiers)})`,
      );
    }

    if (eligibleNames.size > 1) {
      fail(
        `record ${recordLabel(record)} is ambiguous: its identifiers ` +
          `(${identifierTypesLabel(identifiers)}) map to more than one adapter ` +
          `(${[...eligibleNames].join(', ')}) -- an explicit --repository selection is required`,
      );
    }

    const [name] = eligibleNames;
    return this.lookup(name, `dispatched by copy identifier for record ${recordLabel(record)}`);
  }
}
