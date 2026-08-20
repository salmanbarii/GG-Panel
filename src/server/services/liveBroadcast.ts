import type { Server as SocketIOServer } from 'socket.io';
import { systemStats, listAllNodes } from '../services/nodeService.js';
import { findServer, listServers } from '../services/serverStore.js';
import { getRuntime } from '../runtime/runtimeFactory.js';

/**
 * Pushes live resource usage to every connected browser over Socket.IO so the
 * dashboard, nodes list and server overviews update in real time instead of
 * requiring a manual refresh or a polling timer.
 *
 *   • systemStats — panel host resources (dashboard CPU card)
 *   • nodes       — full node inventory (nodes page)
 *   • serverStats — per-server usage, scoped to the server_<id> room
 *
 * Broadcasts only run while at least one client is connected.
 */

const SYSTEM_STATS_INTERVAL = 2000;
const NODES_INTERVAL = 5000;
const SERVER_STATS_INTERVAL = 2000;

export function startLiveBroadcast(io: SocketIOServer): void {
  const hasClients = () => io.engine.clientsCount > 0;

  // Panel host resources — cheap OS calls.
  setInterval(() => {
    if (!hasClients()) return;
    void systemStats()
      .then((stats) => io.emit('systemStats', stats))
      .catch(() => undefined);
  }, SYSTEM_STATS_INTERVAL);

  // Node inventory — involves health checks against Wings daemons, so slower.
  setInterval(() => {
    if (!hasClients()) return;
    void listAllNodes()
      .then((nodes) => io.emit('nodes', nodes))
      .catch(() => undefined);
  }, NODES_INTERVAL);

  // Per-server usage — only for servers that have an open overview/console tab.
  setInterval(() => {
    if (!hasClients()) return;
    const rooms = io.sockets.adapter.rooms;
    const serverIds = new Set<string>();
    for (const name of rooms.keys()) {
      if (name.startsWith('server_')) serverIds.add(name.slice('server_'.length));
    }
    if (serverIds.size === 0) return;

    void (async () => {
      await Promise.all(
        [...serverIds].map(async (serverId) => {
          try {
            const server = await findServer(serverId);
            if (!server) return;
            const runtime = await getRuntime(server);
            const stats = await runtime.getStats(server);
            io.to(`server_${serverId}`).emit('serverStats', { serverId, ...stats });
          } catch {
            /* best-effort: skip servers that disappear mid-flight */
          }
        }),
      );
    })();
  }, SERVER_STATS_INTERVAL);

  // Also refresh running-server stats when the panel starts so a freshly opened
  // overview is never stuck on its initial snapshot before the first tick.
  void (async () => {
    try {
      const servers = await listServers();
      await Promise.all(
        servers.map(async (server) => {
          try {
            const runtime = await getRuntime(server);
            const stats = await runtime.getStats(server);
            io.to(`server_${server.id}`).emit('serverStats', { serverId: server.id, ...stats });
          } catch {
            /* ignore */
          }
        }),
      );
    } catch {
      /* ignore */
    }
  })();
}
