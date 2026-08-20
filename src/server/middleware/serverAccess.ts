import type { NextFunction, Response } from 'express';
import type { GameServer, SubUserPermission } from '../../types/index.js';
import { canAccessServer, findServer } from '../services/serverStore.js';
import type { AuthedRequest } from './auth.js';
import { httpError } from '../utils/http.js';

export interface ServerRequest extends AuthedRequest {
  gameServer?: GameServer;
}

/**
 * Loads `req.params.id` into `req.gameServer` and enforces access + suspension.
 * `permission` narrows sub-user access to a specific scope.
 */
export function loadServer(permission?: SubUserPermission, options?: { allowSuspended?: boolean }) {
  return (req: ServerRequest, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        if (!req.user) throw httpError(401, 'Authentication required');

        const server = await findServer(req.params.id);
        if (!server) throw httpError(404, 'Server not found');

        if (!canAccessServer({ id: req.user.id, role: req.user.role }, server, permission)) {
          throw httpError(403, 'You do not have access to this server');
        }

        const isAdmin = req.user.role === 'admin' || req.user.role === 'owner';
        if (server.suspended && !options?.allowSuspended && !isAdmin) {
          throw httpError(423, 'This server is suspended. Contact an administrator.');
        }

        req.gameServer = server;
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}

/** Non-null accessor for handlers running after loadServer. */
export function currentServer(req: ServerRequest): GameServer {
  if (!req.gameServer) throw httpError(500, 'Server was not loaded');
  return req.gameServer;
}
