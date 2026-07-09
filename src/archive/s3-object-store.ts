/**
 * `S3ObjectStore` is the real, S3-compatible `ObjectStore` backend. It targets
 * Backblaze B2's S3-compatible endpoint (path-style addressing) but works with
 * any S3-compatible service reachable via the AWS SDK v3.
 *
 * Constructed from an `ObjectStoreConfig` (endpoint/region/credentials/bucket).
 * All failures throw descriptive `Error`s — no fallbacks, no mock data, and no
 * silent success. The sole non-error absence path is `head` returning
 * `{ exists: false }` when the object is genuinely not present (404 / NotFound).
 *
 * The secret access key is never logged or embedded in any thrown message.
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { ObjectStore, ObjectHead, PutOptions } from '@/archive/object-store';
import { ObjectStoreConfig } from '@/archive/b2-config';

/**
 * Minimal shape of an SDK error we need to inspect to classify a
 * "not found" outcome. The AWS SDK attaches a `$metadata` object (with an
 * optional `httpStatusCode`) and a `name` to its service errors. We narrow
 * to this shape with a type guard rather than casting, so no `any`/`as` is
 * needed to read the fields.
 */
interface SdkErrorShape {
  name?: unknown;
  $metadata?: { httpStatusCode?: unknown };
}

/**
 * Narrows an unknown thrown value to a shape whose `name` and
 * `$metadata.httpStatusCode` can be read safely, without `any`/`as`.
 */
function asSdkErrorShape(value: unknown): SdkErrorShape {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const shape: SdkErrorShape = {};
  if ('name' in value) {
    shape.name = value.name;
  }
  if ('$metadata' in value) {
    const metadata = value.$metadata;
    if (typeof metadata === 'object' && metadata !== null) {
      if ('httpStatusCode' in metadata) {
        shape.$metadata = { httpStatusCode: metadata.httpStatusCode };
      } else {
        shape.$metadata = {};
      }
    }
  }
  return shape;
}

/**
 * True when the thrown SDK error represents object absence: either the SDK
 * classifies it by `name === 'NotFound'` (HeadObject's typed error) or the
 * HTTP status code is 404.
 */
function isNotFoundError(cause: unknown): boolean {
  const shape = asSdkErrorShape(cause);
  if (shape.name === 'NotFound' || shape.name === 'NoSuchKey') {
    return true;
  }
  return shape.$metadata?.httpStatusCode === 404;
}

/** Renders a cause for a thrown Error message without leaking secrets. */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ObjectStoreConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // B2's S3-compatible endpoint expects path-style bucket addressing.
      forcePathStyle: true,
      // Resilience for long runs (hundreds of head/put/get calls): the SDK
      // default (3 attempts, no client-side throttling) aborts a whole capture
      // on a single transient B2 hiccup. `adaptive` adds client-side rate
      // limiting + backoff on transient/throttling errors; raise the attempt
      // budget so a blip is retried, not fatal.
      maxAttempts: 10,
      retryMode: 'adaptive',
    });
  }

  /**
   * Upload `bytes` at `key`, persisting `options.sha256` as object metadata
   * (the `sha256` metadata drives the writer's idempotent skip on re-run).
   *
   * Resolves only when the object has actually been persisted; throws a
   * descriptive Error wrapping any SDK failure.
   */
  async put(key: string, bytes: Uint8Array, options: PutOptions): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: options.contentType,
          Metadata: { sha256: options.sha256 },
        }),
      );
    } catch (cause) {
      throw new Error(
        `S3ObjectStore.put: failed to upload object at key "${key}": ${describeCause(cause)}`,
      );
    }
  }

  /**
   * Fetch metadata for `key`.
   *
   * Returns `{ exists: false }` when the object is absent (404 / NotFound) —
   * this is a normal, non-error outcome. Re-throws (wrapped, descriptive) any
   * other failure such as auth or transport errors.
   */
  async head(key: string): Promise<ObjectHead> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      const rawEtag = response.ETag;
      const etag =
        rawEtag === undefined ? undefined : rawEtag.replace(/^"|"$/g, '');
      return {
        exists: true,
        sha256: response.Metadata?.sha256,
        size: response.ContentLength,
        etag,
      };
    } catch (cause) {
      if (isNotFoundError(cause)) {
        return { exists: false };
      }
      throw new Error(
        `S3ObjectStore.head: failed to fetch metadata for key "${key}": ${describeCause(cause)}`,
      );
    }
  }

  /**
   * Fetch the bytes stored at `key`, reading the response body stream fully
   * into a `Uint8Array`. Throws a descriptive Error if the object is missing
   * or on transport error.
   */
  async get(key: string): Promise<Uint8Array> {
    let body: GetObjectResponseBody;
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      body = response.Body;
    } catch (cause) {
      throw new Error(
        `S3ObjectStore.get: failed to fetch object at key "${key}": ${describeCause(cause)}`,
      );
    }

    if (body === undefined) {
      throw new Error(
        `S3ObjectStore.get: object at key "${key}" returned an empty body`,
      );
    }

    try {
      return await body.transformToByteArray();
    } catch (cause) {
      throw new Error(
        `S3ObjectStore.get: failed to read response body for key "${key}": ${describeCause(cause)}`,
      );
    }
  }

  /**
   * Rewrite the object's metadata to carry `sha256` (and, when given,
   * `contentType`) WITHOUT re-uploading its bytes. This is a server-side copy
   * of the object onto itself with `MetadataDirective: 'REPLACE'`, which B2/S3
   * services as a metadata update with no data transfer.
   *
   * Resolves only when the metadata rewrite has been applied; throws a
   * descriptive Error wrapping any SDK failure.
   */
  async attachSha256Metadata(
    key: string,
    sha256: string,
    contentType?: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: key,
          CopySource: encodeURI(`${this.bucket}/${key}`),
          MetadataDirective: 'REPLACE',
          Metadata: { sha256 },
          ContentType: contentType,
        }),
      );
    } catch (cause) {
      throw new Error(
        `S3ObjectStore.attachSha256Metadata: failed to backfill sha256 metadata for key "${key}": ${describeCause(cause)}`,
      );
    }
  }
}

/**
 * The `Body` field of a `GetObjectCommand` response, taken directly from the
 * SDK's own output type. In the Node runtime the SDK mixes `transformToByteArray`
 * into this stream type; referencing the SDK type keeps us free of `any`/`as`.
 */
type GetObjectResponseBody = GetObjectCommandOutput['Body'];
