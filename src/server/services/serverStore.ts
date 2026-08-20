import type { GameServer, SubUser, SubUserPermission, UserRole } from '../../types/index.js';
import { FILES, readJSON, updateJSON } from '../utils/jsonStore.js';

/** servers.json access + ownership/permission helpers. */

export async function listServers(): Promise<GameServer[]> {
  return readJSON<GameServer[]>(FILES.servers, []);
}

export async function findServer(id: string): Promise<GameServer | undefined> {
  return (await listServers()).find((s) => s.id === id);
}

export async function saveServer(server: GameServer): Promise<GameServer> {
  await updateJSON<GameServer[]>(FILES.servers, [], (current) => [...current, server]);
  return server;
}

export async function patchServer(
  id: string,
  patch: Partial<Omit<GameServer, 'id' | 'createdAt'>>,
): Promise<GameServer> {
  let updated: GameServer | undefined;
  await updateJSON<GameServer[]>(FILES.servers, [], (current) =>
    current.map((server) => {
      if (server.id !== id) return server;
      updated = { ...server, ...patch, id: server.id, createdAt: server.createdAt };
      return updated;
    }),
  );
  if (!updated) throw Object.assign(new Error('Server not found'), { statusCode: 404 });
  return updated;
}

export async function removeServer(id: string): Promise<void> {
  await updateJSON<GameServer[]>(FILES.servers, [], (current) => current.filter((s) => s.id !== id));
}

export async function isPortTaken(port: number, ignoreServerId?: string): Promise<boolean> {
  const servers = await listServers();
  return servers.some((s) => s.port === port && s.id !== ignoreServerId);
}

/** Suggest the next free port starting from 25565. */
export async function suggestPort(start = 25565): Promise<number> {
  const servers = await listServers();
  const used = new Set(servers.map((s) => s.port));
  let port = start;
  while (used.has(port) && port < 65535) port += 1;
  return port;
}

export interface Viewer {
  id: string;
  role: UserRole;
}

export function isOwnerOrAdmin(viewer: Viewer, server: GameServer): boolean {
  return viewer.role === 'owner' || viewer.role === 'admin' || server.owner === viewer.id;
}

export function findSubUser(server: GameServer, userId: string): SubUser | undefined {
  return server.subUsers?.find((s) => s.userId === userId);
}

/**
 * Access rules: owners/admins see everything, the server owner has full access,
 * sub-users need the matching permission scope.
 */
export function canAccessServer(
  viewer: Viewer,
  server: GameServer,
  permission?: SubUserPermission,
): boolean {
  if (viewer.role === 'owner' || viewer.role === 'admin') return true;
  if (server.owner === viewer.id) return true;
  const sub = findSubUser(server, viewer.id);
  if (!sub) return false;
  if (!permission) return true;
  return sub.permissions.includes(permission);
}

export async function listServersForViewer(viewer: Viewer): Promise<GameServer[]> {
  const servers = await listServers();
  if (viewer.role === 'owner' || viewer.role === 'admin') return servers;
  return servers.filter(
    (server) => server.owner === viewer.id || Boolean(findSubUser(server, viewer.id)),
  );
}
