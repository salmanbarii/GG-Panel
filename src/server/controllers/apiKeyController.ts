import type { Response } from 'express';
import type { ApiKeyScope } from '../../types/index.js';
import { asyncHandler, httpError, requireString } from '../utils/http.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  ALL_SCOPES,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  listApiKeysForOwner,
  toPublicApiKey,
  updateApiKey,
} from '../services/apiKeyStore.js';
import { isAdmin } from '../services/userStore.js';

/** Named API keys with scopes. Users see their own; admins see all. */

/** GET /api/admin/api-keys */
export const list = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  const all = isAdmin(req.user) && String(req.query.all ?? 'false') === 'true';
  res.json({
    keys: await listApiKeysForOwner(req.user.id, all),
    availableScopes: ALL_SCOPES,
  });
});

/** POST /api/admin/api-keys */
export const create = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (!req.user) throw httpError(401, 'Authentication required');

  const requested: unknown = req.body?.scopes;
  const scopes = (Array.isArray(requested) ? requested.map(String) : ['servers:read']).filter(
    (scope): scope is ApiKeyScope => ALL_SCOPES.includes(scope as ApiKeyScope),
  );

  if (scopes.includes('admin') && !isAdmin(req.user)) {
    throw httpError(403, 'Only administrators can create keys with the admin scope');
  }

  const key = await createApiKey({
    name: requireString(req.body?.name, 'name'),
    scopes,
    owner: req.user.id,
  });

  res.status(201).json({
    key,
    warning: 'Copy this key now — it is stored hashed and cannot be retrieved again.',
  });
});

async function assertOwnership(req: AuthedRequest, id: string) {
  if (!req.user) throw httpError(401, 'Authentication required');
  const keys = await listApiKeys();
  const key = keys.find((k) => k.id === id);
  if (!key) throw httpError(404, 'API key not found');
  if (key.owner !== req.user.id && !isAdmin(req.user)) {
    throw httpError(403, 'You can only manage your own API keys');
  }
  return key;
}

/** PUT /api/admin/api-keys/:id */
export const update = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  await assertOwnership(req, req.params.id);

  const requested: unknown = req.body?.scopes;
  const scopes = Array.isArray(requested)
    ? requested
        .map(String)
        .filter((scope): scope is ApiKeyScope => ALL_SCOPES.includes(scope as ApiKeyScope))
    : undefined;

  if (scopes?.includes('admin') && !isAdmin(req.user)) {
    throw httpError(403, 'Only administrators can grant the admin scope');
  }

  const key = await updateApiKey(req.params.id, {
    name: typeof req.body?.name === 'string' ? req.body.name : undefined,
    scopes,
  });
  res.json({ key });
});

/** DELETE /api/admin/api-keys/:id */
export const remove = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const key = await assertOwnership(req, req.params.id);
  await deleteApiKey(key.id);
  res.json({ success: true, key: toPublicApiKey(key) });
});
