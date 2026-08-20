import type { Response } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import { asyncHandler, httpError } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import { analyzeWorld, importWorld } from '../services/worldService.js';
import { safeServerPath } from '../utils/paths.js';
import { getRuntime } from '../runtime/runtimeFactory.js';
import { emitInstall } from '../utils/panelEvents.js';

interface WorldUploadRequest extends ServerRequest {
  file?: Express.Multer.File;
}

/** GET /api/servers/:id/world/info and POST /analyze */
export const info = asyncHandler<ServerRequest>(async (req, res: Response) => {
  res.json({ world: await analyzeWorld(currentServer(req).id) });
});

export const analyze = asyncHandler<ServerRequest>(async (req, res: Response) => {
  res.json({ world: await analyzeWorld(currentServer(req).id) });
});

/**
 * POST /api/servers/:id/world/import
 * Either a multipart upload (`world` field) or `path` pointing at an already
 * uploaded zip inside the server directory.
 */
export const importWorldHandler = asyncHandler<WorldUploadRequest>(async (req, res: Response) => {
  const server = currentServer(req);

  const runtime = await getRuntime(server);
  const status = await runtime.getStatus(server);
  if (status === 'online' || status === 'starting') {
    if (req.body?.force !== 'true' && req.body?.force !== true) {
      throw httpError(409, 'Stop the server before importing a world (or pass force: true)');
    }
    await runtime.stopServer(server);
  }

  let zipPath: string | null = null;
  let cleanup = false;

  if (req.file) {
    zipPath = req.file.path;
    cleanup = true;
  } else if (typeof req.body?.path === 'string' && req.body.path.trim()) {
    zipPath = safeServerPath(server.id, req.body.path);
    if (!(await fs.pathExists(zipPath))) throw httpError(404, 'Archive not found');
  }

  if (!zipPath) throw httpError(400, 'Upload a world .zip or provide a path to one');
  if (!zipPath.toLowerCase().endsWith('.zip')) {
    throw httpError(400, 'World imports must be .zip archives');
  }

  try {
    emitInstall(server.id, `Importing world from ${path.basename(zipPath)}…\n`);
    const world = await importWorld({
      serverId: server.id,
      zipPath,
      targetName: typeof req.body?.name === 'string' ? req.body.name : undefined,
      keepBackup: req.body?.keepBackup !== 'false' && req.body?.keepBackup !== false,
    });
    emitInstall(server.id, `World "${world.name}" imported.\n`, true);
    res.status(201).json({ world });
  } finally {
    if (cleanup) await fs.remove(zipPath).catch(() => undefined);
  }
});
