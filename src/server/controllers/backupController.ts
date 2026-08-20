import type { Response } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import { asyncHandler, httpError } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import {
  backupFilePath,
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
} from '../services/backupService.js';
import { getRuntime } from '../runtime/runtimeFactory.js';
import { emitInstall } from '../utils/panelEvents.js';

/** GET /api/servers/:id/backups */
export const list = asyncHandler<ServerRequest>(async (req, res: Response) => {
  res.json({ backups: await listBackups(currentServer(req).id) });
});

/** POST /api/servers/:id/backups */
export const create = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const lean = req.body?.lean !== false;

  const backup = await createBackup({
    serverId: server.id,
    serverName: server.name,
    lean,
    onProgress: (bytes, entries) => {
      if (entries % 250 === 0) {
        emitInstall(server.id, `Backup: ${entries} files, ${(bytes / 1024 / 1024).toFixed(1)} MB\n`);
      }
    },
  });

  emitInstall(server.id, `Backup created: ${backup.filename}\n`, true);
  res.status(201).json({ backup });
});

/** GET /api/servers/:id/backups/:filename */
export const download = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const file = backupFilePath(server.id, req.params.filename);
  if (!(await fs.pathExists(file))) throw httpError(404, 'Backup not found');
  res.download(file, path.basename(file));
});

/** DELETE /api/servers/:id/backups/:filename */
export const remove = asyncHandler<ServerRequest>(async (req, res: Response) => {
  await deleteBackup(currentServer(req).id, req.params.filename);
  res.json({ success: true });
});

/** POST /api/servers/:id/backups/:filename/restore */
export const restore = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);

  // The server must be stopped before its files are swapped out.
  const runtime = await getRuntime(server);
  const status = await runtime.getStatus(server);
  if (status === 'online' || status === 'starting') {
    if (req.body?.force !== true) {
      throw httpError(409, 'Stop the server before restoring a backup (or pass force: true)');
    }
    await runtime.stopServer(server);
  }

  emitInstall(server.id, `Restoring ${req.params.filename}…\n`);
  await restoreBackup(server.id, req.params.filename);
  emitInstall(server.id, 'Restore complete.\n', true);

  res.json({ success: true });
});
