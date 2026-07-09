/**
 * Resolves the `ObjectStoreConfig` used to construct the Backblaze
 * B2-backed `ObjectStore`.
 *
 * Non-secret configuration (bucket/endpoint/region) comes from env vars.
 * Credentials (accessKeyId/secretAccessKey) are parsed out of a
 * Backblaze-style credentials file (YAML-looking, but hand-parsed here
 * rather than pulling in a YAML dependency for three lines):
 *
 *   keyID: <id>
 *   keyName: <name>
 *   applicationKey:\t<secret>
 *
 * Backblaze's own credential-file generator emits the `applicationKey`
 * line with a TAB after the colon rather than a space, so the line parser
 * strips all leading whitespace (spaces AND tabs) from the value.
 *
 * Fails loud: throws a descriptive Error if any required env var is
 * missing, if the credentials file cannot be read, or if the file does not
 * contain both `keyID` and `applicationKey`. Never returns a partial
 * config and never falls back to a default for a secret.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ObjectStoreConfig {
  provider: 'backblaze-b2';
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string; // never log
  secretAccessKey: string; // never log
}

const DEFAULT_CREDENTIALS_PATH = join(
  '.config',
  'backblaze',
  'b2-credentials.txt',
);

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `resolveObjectStoreConfig: required environment variable "${name}" is not set`,
    );
  }
  return value;
}

function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

interface ParsedCredentials {
  keyID?: string;
  applicationKey?: string;
}

/**
 * Parses the `key: value` lines of a Backblaze credentials file.
 *
 * Strips leading whitespace from the value using `\s`, which covers both
 * spaces and tabs -- required because Backblaze emits the
 * `applicationKey:` line with a TAB separator instead of a space.
 */
function parseCredentialsContents(contents: string): ParsedCredentials {
  const parsed: ParsedCredentials = {};

  for (const line of contents.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1);
    const value = rawValue.replace(/^\s+/, '').replace(/\s+$/, '');

    if (key === 'keyID') {
      parsed.keyID = value;
    } else if (key === 'applicationKey') {
      parsed.applicationKey = value;
    }
  }

  return parsed;
}

interface RequiredCredentials {
  keyID: string;
  applicationKey: string;
}

function readCredentials(credentialsPath: string): RequiredCredentials {
  let contents: string;
  try {
    contents = readFileSync(credentialsPath, 'utf8');
  } catch (cause) {
    throw new Error(
      `resolveObjectStoreConfig: could not read B2 credentials file at "${credentialsPath}": ${String(cause)}`,
    );
  }

  const { keyID, applicationKey } = parseCredentialsContents(contents);

  if (!keyID) {
    throw new Error(
      `resolveObjectStoreConfig: B2 credentials file at "${credentialsPath}" is missing a "keyID" line`,
    );
  }
  if (!applicationKey) {
    throw new Error(
      `resolveObjectStoreConfig: B2 credentials file at "${credentialsPath}" is missing an "applicationKey" line`,
    );
  }

  return { keyID, applicationKey };
}

/**
 * Resolves the full object-store config, reading non-secret fields from
 * `env` (defaulting to `process.env`) and credentials from the file at
 * `COLONY_B2_CREDENTIALS` (defaulting to
 * `~/.config/backblaze/b2-credentials.txt`).
 *
 * Throws a descriptive Error rather than returning a partial config if any
 * required value is missing.
 */
export function resolveObjectStoreConfig(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStoreConfig {
  const bucket = requireEnv(env, 'COLONY_S3_BUCKET');
  const endpoint = requireEnv(env, 'COLONY_S3_ENDPOINT');
  const region = requireEnv(env, 'COLONY_S3_REGION');

  const credentialsPathRaw =
    env.COLONY_B2_CREDENTIALS && env.COLONY_B2_CREDENTIALS !== ''
      ? env.COLONY_B2_CREDENTIALS
      : join('~', DEFAULT_CREDENTIALS_PATH);
  const credentialsPath = expandHome(credentialsPathRaw);

  const credentials = readCredentials(credentialsPath);

  return {
    provider: 'backblaze-b2',
    bucket,
    endpoint,
    region,
    accessKeyId: credentials.keyID,
    secretAccessKey: credentials.applicationKey,
  };
}
