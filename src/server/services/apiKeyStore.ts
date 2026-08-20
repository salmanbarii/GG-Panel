import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type { ApiKey, ApiKeyScope, PublicApiKey } from '../../types/index.js';
import { FILES, readJSON, updateJSON } from '../utils/jsonStore.js';

/** api_keys.json — only sha256 hashes are stored, the raw key is shown once. */

export const ALL_SCOPES: ApiKeyScope[] = [
  'servers:read',
  'servers:write',
  'servers:power',
  'files:read',
  'files:write',
  'backups:read',
  'backups:write',
  'nodes:read',
  'admin',
];

function hash(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function toPublicApiKey(key: ApiKey): PublicApiKey {
  const { keyHash: _keyHash, ...rest } = key;
  return rest;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return readJSON<ApiKey[]>(FILES.apiKeys, []);
}

export async function listApiKeysForOwner(ownerId: string, all = false): Promise<PublicApiKey[]> {
  const keys = await listApiKeys();
  return keys.filter((k) => all || k.owner === ownerId).map(toPublicApiKey);
}

export async function createApiKey(input: {
  name: string;
  scopes: ApiKeyScope[];
  owner: string;
}): Promise<PublicApiKey> {
  const name = input.name?.trim();
  if (!name) throw Object.assign(new Error('A key name is required'), { statusCode: 400 });

  const scopes = (input.scopes ?? []).filter((s) => ALL_SCOPES.includes(s));
  if (scopes.length === 0) {
    throw Object.assign(new Error('At least one scope is required'), { statusCode: 400 });
  }

  const raw = `gg_${crypto.randomBytes(24).toString('hex')}`;
  const record: ApiKey = {
    id: uuid(),
    name,
    keyPrefix: raw.slice(0, 12),
    keyHash: hash(raw),
    scopes,
    owner: input.owner,
    createdAt: new Date().toISOString(),
  };

  await updateJSON<ApiKey[]>(FILES.apiKeys, [], (current) => [...current, record]);
  return { ...toPublicApiKey(record), key: raw };
}

export async function updateApiKey(
  id: string,
  patch: Partial<Pick<ApiKey, 'name' | 'scopes'>>,
): Promise<PublicApiKey> {
  let updated: ApiKey | undefined;
  await updateJSON<ApiKey[]>(FILES.apiKeys, [], (current) =>
    current.map((key) => {
      if (key.id !== id) return key;
      updated = {
        ...key,
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.scopes ? { scopes: patch.scopes.filter((s) => ALL_SCOPES.includes(s)) } : {}),
      };
      return updated;
    }),
  );
  if (!updated) throw Object.assign(new Error('API key not found'), { statusCode: 404 });
  return toPublicApiKey(updated);
}

export async function deleteApiKey(id: string): Promise<void> {
  const keys = await listApiKeys();
  if (!keys.some((k) => k.id === id)) {
    throw Object.assign(new Error('API key not found'), { statusCode: 404 });
  }
  await updateJSON<ApiKey[]>(FILES.apiKeys, [], (current) => current.filter((k) => k.id !== id));
}

export async function verifyApiKey(raw: string): Promise<ApiKey | undefined> {
  if (!raw) return undefined;
  const digest = hash(raw.trim());
  return (await listApiKeys()).find((k) => k.keyHash === digest);
}

export async function touchApiKey(id: string): Promise<void> {
  await updateJSON<ApiKey[]>(FILES.apiKeys, [], (current) =>
    current.map((k) => (k.id === id ? { ...k, lastUsedAt: new Date().toISOString() } : k)),
  ).catch(() => undefined);
}
