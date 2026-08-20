import type { Response } from 'express';
import { asyncHandler, httpError, requireString } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import {
  installAddon,
  listInstalledAddons,
  loaderForServerType,
  removeAddon,
  searchModrinth,
  toggleAddon,
  type AddonKind,
} from '../services/addonService.js';

/** Plugins and mods share the same controller with a different target folder. */

function kindFromPath(req: ServerRequest): AddonKind {
  return req.baseUrl.includes('/mods') || req.path.includes('/mods') ? 'mod' : 'plugin';
}

/** GET /api/servers/:id/plugins|mods */
export const list = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const kind = kindFromPath(req);
  res.json({ installed: await listInstalledAddons(server.id, kind), kind });
});

/** GET /api/servers/:id/plugins|mods/search?q=... */
export const search = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const kind = kindFromPath(req);

  const result = await searchModrinth({
    query: String(req.query.q ?? req.query.query ?? ''),
    kind,
    gameVersion:
      typeof req.query.gameVersion === 'string' && req.query.gameVersion
        ? req.query.gameVersion
        : req.query.anyVersion === 'true'
          ? undefined
          : server.version,
    loader:
      typeof req.query.loader === 'string' && req.query.loader
        ? req.query.loader
        : loaderForServerType(server.serverType),
    limit: Number.parseInt(String(req.query.limit ?? '20'), 10),
    offset: Number.parseInt(String(req.query.offset ?? '0'), 10),
  });

  res.json(result);
});

/** POST /api/servers/:id/plugins|mods — install by slug, project URL or jar URL. */
export const install = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const kind = kindFromPath(req);
  const source = requireString(
    req.body?.source ?? req.body?.url ?? req.body?.slug ?? req.body?.projectId,
    'source',
  );

  const result = await installAddon({
    serverId: server.id,
    kind,
    source,
    gameVersion:
      typeof req.body?.gameVersion === 'string' && req.body.gameVersion
        ? req.body.gameVersion
        : server.version,
    loader:
      typeof req.body?.loader === 'string' && req.body.loader
        ? req.body.loader
        : loaderForServerType(server.serverType),
  });

  res.status(201).json({
    success: true,
    installed: result,
    note: 'Restart the server to load the new file.',
  });
});

/** DELETE /api/servers/:id/plugins|mods/:filename */
export const remove = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const kind = kindFromPath(req);
  if (!req.params.filename) throw httpError(400, 'filename is required');
  await removeAddon(server.id, kind, req.params.filename);
  res.json({ success: true });
});

/** POST /api/servers/:id/plugins|mods/:filename/toggle */
export const toggle = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const kind = kindFromPath(req);
  const addon = await toggleAddon(server.id, kind, req.params.filename);
  res.json({ success: true, addon });
});
