import type { Response } from 'express';
import type { GameServer, SubUser, SubUserPermission } from '../../types/index.js';
import { asyncHandler, httpError, parsePositiveInt, requireString } from '../utils/http.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import {
  findServer,
  listServersForViewer,
  patchServer,
} from '../services/serverStore.js';
import { isAdmin, listUsers } from '../services/userStore.js';
import {
  changeVersion,
  checkPort,
  createServer,
  deleteServer,
  getLogs,
  getStats,
  migrateRuntime,
  panelTotals,
  reassignOwner,
  redownloadJar,
  restartServer,
  sendCommand,
  setSuspended,
  startServer,
  stopServer,
  toView,
  toViews,
  updateResources,
  updateSettings,
} from '../services/serverService.js';
import { listVersionsFor } from '../services/jarDownloader.js';

const PERMISSIONS: SubUserPermission[] = [
  'console',
  'files',
  'settings',
  'backups',
  'plugins',
  'players',
  'world',
  'sftp',
  'power',
];

/** GET /api/servers */
export const list = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  const servers = await listServersForViewer({ id: req.user.id, role: req.user.role });
  res.json({ servers: await toViews(servers) });
});

/** GET /api/servers/totals — dashboard aggregates. */
export const totals = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (!req.user) throw httpError(401, 'Authentication required');

  if (isAdmin(req.user)) {
    res.json(await panelTotals());
    return;
  }

  const servers = await listServersForViewer({ id: req.user.id, role: req.user.role });
  const views = await toViews(servers);
  res.json({
    totalServers: servers.length,
    runningServers: views.filter((v) => v.isRunning).length,
    totalRamGb: servers.reduce((sum, s) => sum + s.ram, 0),
    totalCpuPercent: servers.reduce((sum, s) => sum + s.cpu, 0),
    suspended: servers.filter((s) => s.suspended).length,
  });
});

/** GET /api/servers/check-port?port=25565 */
export const checkPortHandler = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const port = Number.parseInt(String(req.query.port ?? ''), 10);
  const ignore = typeof req.query.serverId === 'string' ? req.query.serverId : undefined;
  res.json(await checkPort(port, ignore));
});

/** GET /api/servers/versions?serverType=paper */
export const versions = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const serverType = String(req.query.serverType ?? 'vanilla') as Parameters<
    typeof listVersionsFor
  >[0];
  const snapshots = String(req.query.snapshots ?? 'false') === 'true';
  res.json({ versions: await listVersionsFor(serverType, snapshots) });
});

/** POST /api/servers */
export const create = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  const ownerId =
    isAdmin(req.user) && typeof req.body?.owner === 'string' && req.body.owner
      ? req.body.owner
      : req.user.id;

  const { server, warnings } = await createServer(req.body ?? {}, ownerId);
  res.status(201).json({ server: await toView(server), warnings });
});

/** GET /api/servers/:id */
export const get = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const users = await listUsers();
  const usernames = new Map(users.map((u) => [u.id, u.username]));
  res.json({ server: await toView(server, { usernames }) });
});

/** DELETE /api/servers/:id */
export const remove = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  if (!req.user) throw httpError(401, 'Authentication required');
  if (!isAdmin(req.user) && server.owner !== req.user.id) {
    throw httpError(403, 'Only the server owner or an administrator can delete this server');
  }
  const keepBackups = String(req.query.keepBackups ?? 'false') === 'true';
  await deleteServer(server.id, { keepBackups });
  res.json({ success: true });
});

/** POST /api/servers/:id/start|stop|restart */
export const start = asyncHandler<ServerRequest>(async (req, res: Response) => {
  await startServer(currentServer(req));
  res.json({ success: true, status: 'starting' });
});

export const stop = asyncHandler<ServerRequest>(async (req, res: Response) => {
  await stopServer(currentServer(req));
  res.json({ success: true, status: 'stopping' });
});

export const restart = asyncHandler<ServerRequest>(async (req, res: Response) => {
  await restartServer(currentServer(req));
  res.json({ success: true, status: 'starting' });
});

/** POST /api/servers/:id/command */
export const command = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const cmd = requireString(req.body?.command, 'Command');
  await sendCommand(currentServer(req), cmd);
  res.json({ success: true });
});

/** GET /api/servers/:id/stats */
export const stats = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const result = await getStats(server);
  res.json(result);
});

/** GET /api/servers/:id/logs?lines=300 */
export const logs = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const lines = parsePositiveInt(req.query.lines, 300);
  res.json({ logs: await getLogs(currentServer(req), Math.min(lines, 5000)) });
});

/** PUT /api/servers/:id/resources */
export const resources = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const updated = await updateResources(currentServer(req), {
    ram: req.body?.ram,
    cpu: req.body?.cpu,
  });
  res.json({ server: await toView(updated) });
});

/** PUT /api/servers/:id — general settings (name, port, icon, alias). */
export const update = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const updated = await updateSettings(currentServer(req), req.body ?? {});
  res.json({ server: await toView(updated) });
});

/** PUT /api/servers/:id/version */
export const version = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const updated = await changeVersion(currentServer(req), {
    version: req.body?.version,
    serverType: req.body?.serverType,
    javaVersion: req.body?.javaVersion,
  });
  res.json({ server: await toView(updated) });
});

/** PUT /api/servers/:id/migrate-runtime */
export const migrate = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const target = requireString(req.body?.runtimeType, 'runtimeType');
  const updated = await migrateRuntime(currentServer(req), target as 'docker' | 'local');
  res.json({ server: await toView(updated) });
});

/** PUT /api/servers/:id/suspend — admin only. */
export const suspend = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const suspended = Boolean(req.body?.suspended ?? true);
  const updated = await setSuspended(currentServer(req), suspended);
  res.json({ server: await toView(updated) });
});

/** PUT /api/servers/:id/owner — admin only. */
export const owner = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const newOwner = requireString(req.body?.owner ?? req.body?.userId, 'owner');
  const updated = await reassignOwner(currentServer(req), newOwner);
  res.json({ server: await toView(updated) });
});

/** PUT /api/servers/:id/ipalias */
export const ipAlias = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const alias = typeof req.body?.ipAlias === 'string' ? req.body.ipAlias.trim() : '';
  if (alias.length > 253) throw httpError(400, 'Alias is too long');
  const updated = await patchServer(currentServer(req).id, { ipAlias: alias });
  res.json({ server: await toView(updated) });
});

/** POST /api/servers/:id/redownload-jar and /reinstall */
export const reinstall = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const updated = await redownloadJar(currentServer(req));
  res.json({ server: await toView(updated) });
});

// ── sub-users ──────────────────────────────────────────────────────────────

/** GET /api/servers/:id/subusers */
export const listSubUsers = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  res.json({ subUsers: server.subUsers ?? [], availablePermissions: PERMISSIONS });
});

/** POST /api/servers/:id/subusers */
export const addSubUser = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  if (!req.user) throw httpError(401, 'Authentication required');
  if (!isAdmin(req.user) && server.owner !== req.user.id) {
    throw httpError(403, 'Only the server owner can manage sub-users');
  }

  const identifier = requireString(req.body?.username ?? req.body?.userId, 'username');
  const users = await listUsers();
  const target =
    users.find((u) => u.id === identifier) ??
    users.find((u) => u.username.toLowerCase() === identifier.toLowerCase());

  if (!target) throw httpError(404, 'User not found');
  if (target.id === server.owner) throw httpError(400, 'The owner already has full access');

  const requested: SubUserPermission[] = Array.isArray(req.body?.permissions)
    ? (req.body.permissions as string[]).filter((p): p is SubUserPermission =>
        PERMISSIONS.includes(p as SubUserPermission),
      )
    : ['console'];

  const subUser: SubUser = {
    userId: target.id,
    username: target.username,
    permissions: requested.length ? requested : ['console'],
  };

  const next = [...(server.subUsers ?? []).filter((s) => s.userId !== target.id), subUser];
  const updated = await patchServer(server.id, { subUsers: next });
  res.status(201).json({ subUsers: updated.subUsers });
});

/** PUT /api/servers/:id/subusers/:userId */
export const updateSubUser = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  if (!req.user) throw httpError(401, 'Authentication required');
  if (!isAdmin(req.user) && server.owner !== req.user.id) {
    throw httpError(403, 'Only the server owner can manage sub-users');
  }

  const existing = (server.subUsers ?? []).find((s) => s.userId === req.params.userId);
  if (!existing) throw httpError(404, 'Sub-user not found');

  const permissions: SubUserPermission[] = Array.isArray(req.body?.permissions)
    ? (req.body.permissions as string[]).filter((p): p is SubUserPermission =>
        PERMISSIONS.includes(p as SubUserPermission),
      )
    : existing.permissions;

  const next = (server.subUsers ?? []).map((s) =>
    s.userId === existing.userId ? { ...s, permissions } : s,
  );
  const updated = await patchServer(server.id, { subUsers: next });
  res.json({ subUsers: updated.subUsers });
});

/** DELETE /api/servers/:id/subusers/:userId */
export const removeSubUser = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  if (!req.user) throw httpError(401, 'Authentication required');
  if (!isAdmin(req.user) && server.owner !== req.user.id) {
    throw httpError(403, 'Only the server owner can manage sub-users');
  }

  const next = (server.subUsers ?? []).filter((s) => s.userId !== req.params.userId);
  const updated = await patchServer(server.id, { subUsers: next });
  res.json({ subUsers: updated.subUsers });
});

// ── admin listing ──────────────────────────────────────────────────────────

/** GET /api/admin/servers — every server with owner names. */
export const adminList = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  const { listServers } = await import('../services/serverStore.js');
  const servers: GameServer[] = await listServers();
  res.json({ servers: await toViews(servers) });
});

/** Helper used by admin routes that operate on a raw id. */
export async function requireServer(id: string): Promise<GameServer> {
  const server = await findServer(id);
  if (!server) throw httpError(404, 'Server not found');
  return server;
}
