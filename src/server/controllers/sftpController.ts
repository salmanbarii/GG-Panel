import type { Response } from 'express';
import os from 'node:os';
import { asyncHandler, httpError } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import {
  deleteSftpUser,
  getSftpCredentials,
  upsertSftpUser,
} from '../services/sftp.js';
import { config } from '../utils/config.js';
import { isAdmin } from '../services/userStore.js';

/** Host shown in the credentials card: explicit PUBLIC_HOST, else the request host. */
function resolveHost(req: ServerRequest): string {
  if (config.publicHost) return config.publicHost;
  const forwarded = req.headers['x-forwarded-host'];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.hostname;
  const host = String(header ?? '').split(':')[0];
  return host && host !== 'localhost' ? host : os.hostname();
}

/** GET /api/servers/:id/sftp */
export const get = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const credentials = await getSftpCredentials(server.id);
  res.json({
    sftp: { ...credentials, host: resolveHost(req), port: config.sftpPort },
  });
});

/** POST /api/servers/:id/sftp — create the account or reset its password. */
export const reset = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const credentials = await upsertSftpUser(server.id, server.name);
  res.status(201).json({
    sftp: { ...credentials, host: resolveHost(req), port: config.sftpPort },
    warning: 'Copy this password now — it is hashed and cannot be shown again.',
  });
});

/** DELETE /api/servers/:id/sftp */
export const remove = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  if (!req.user) throw httpError(401, 'Authentication required');
  if (!isAdmin(req.user) && server.owner !== req.user.id) {
    throw httpError(403, 'Only the server owner can remove SFTP access');
  }
  await deleteSftpUser(server.id);
  res.json({ success: true });
});
