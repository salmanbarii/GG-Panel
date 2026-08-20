import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { LogPayload, PublicUser, StatusPayload } from '../types/index.js';
import { verifyToken } from './middleware/auth.js';
import { findUserById, toPublicUser } from './services/userStore.js';
import { canAccessServer, findServer } from './services/serverStore.js';
import { getRuntime } from './runtime/runtimeFactory.js';
import { panelEvents } from './utils/panelEvents.js';
import { getUpdateStatus } from './services/updateService.js';
import { startLiveBroadcast } from './services/liveBroadcast.js';

/**
 * Socket.IO layer. Clients authenticate with the same JWT used by the REST API,
 * then join `server_<id>` rooms. Runtime providers publish through panelEvents
 * and this module fans the events out to the rooms.
 */

interface AuthedSocket extends Socket {
  user?: PublicUser;
}

function room(serverId: string): string {
  return `server_${serverId}`;
}

export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1e6,
    pingTimeout: 30_000,
  });

  // ── auth middleware on every connection ──────────────────────────────────
  io.use((socket: AuthedSocket, next) => {
    void (async () => {
      try {
        const token =
          (socket.handshake.auth?.token as string | undefined) ??
          (socket.handshake.query?.token as string | undefined);
        if (!token) return next(new Error('Authentication required'));

        const payload = verifyToken(token);
        const user = await findUserById(payload.sub);
        if (!user) return next(new Error('Account no longer exists'));

        socket.user = toPublicUser(user);
        next();
      } catch {
        next(new Error('Invalid or expired session'));
      }
    })();
  });

  // Detach functions per socket so log streams are cleaned up on disconnect.
  const attachments = new WeakMap<Socket, Map<string, () => void>>();

  io.on('connection', (socket: AuthedSocket) => {
    attachments.set(socket, new Map());

    socket.emit('ready', { user: socket.user, updateStatus: getUpdateStatus() });

    socket.on('joinServer', (serverId: unknown) => {
      void (async () => {
        try {
          const id = String(serverId ?? '');
          if (!id || !socket.user) return;

          const server = await findServer(id);
          if (!server) {
            socket.emit('serverError', { serverId: id, error: 'Server not found' });
            return;
          }

          if (!canAccessServer({ id: socket.user.id, role: socket.user.role }, server, 'console')) {
            socket.emit('serverError', { serverId: id, error: 'Access denied' });
            return;
          }

          await socket.join(room(id));

          const runtime = await getRuntime(server);

          // Replay recent history so the console is never empty on open.
          const history = await runtime.getLogs(server, 250).catch(() => '');
          if (history) socket.emit('logHistory', { serverId: id, data: history } satisfies LogPayload);

          const status = await runtime.getStatus(server).catch(() => 'offline' as const);
          socket.emit('status', { serverId: id, status } satisfies StatusPayload);

          // One live stream per server, shared by all sockets in the room.
          const sockets = await io.in(room(id)).fetchSockets();
          if (sockets.length === 1) {
            const detach = await runtime.attachSocket(server).catch(() => () => undefined);
            streamDetachers.set(id, detach);
          }

          attachments.get(socket)?.set(id, () => undefined);
        } catch (err) {
          socket.emit('serverError', {
            serverId: String(serverId ?? ''),
            error: err instanceof Error ? err.message : 'Failed to join server',
          });
        }
      })();
    });

    socket.on('leaveServer', (serverId: unknown) => {
      void (async () => {
        const id = String(serverId ?? '');
        if (!id) return;
        await socket.leave(room(id));
        attachments.get(socket)?.delete(id);
        await maybeDetach(io, id);
      })();
    });

    socket.on('command', (payload: unknown) => {
      void (async () => {
        try {
          const { serverId, command } = (payload ?? {}) as { serverId?: string; command?: string };
          if (!serverId || !command || !socket.user) return;

          const server = await findServer(serverId);
          if (!server) return;
          if (!canAccessServer({ id: socket.user.id, role: socket.user.role }, server, 'console')) {
            socket.emit('serverError', { serverId, error: 'Access denied' });
            return;
          }

          const runtime = await getRuntime(server);
          await runtime.sendCommand(server, command);
        } catch (err) {
          socket.emit('serverError', {
            serverId: '',
            error: err instanceof Error ? err.message : 'Command failed',
          });
        }
      })();
    });

    socket.on('disconnect', () => {
      void (async () => {
        const joined = attachments.get(socket);
        attachments.delete(socket);
        for (const id of joined?.keys() ?? []) {
          await maybeDetach(io, id);
        }
      })();
    });
  });

  // ── panelEvents → rooms ──────────────────────────────────────────────────
  panelEvents.onTyped('log', ({ serverId, data }) => {
    io.to(room(serverId)).emit('log', { serverId, data } satisfies LogPayload);
  });

  panelEvents.onTyped('status', ({ serverId, status }) => {
    io.to(room(serverId)).emit('status', { serverId, status } satisfies StatusPayload);
    io.emit('serverStatus', { serverId, status });
  });

  panelEvents.onTyped('install', ({ serverId, data, done }) => {
    io.to(room(serverId)).emit('install', { serverId, data, done });
    io.emit('installProgress', { serverId, data, done });
  });

  panelEvents.onTyped('stats', (payload) => {
    io.to(room(payload.serverId)).emit('stats', payload);
  });

  panelEvents.onTyped('systemUpdate', (payload) => {
    io.emit('systemUpdate', payload);
  });

  panelEvents.onTyped('notification', (payload) => {
    io.emit('notification', payload);
  });

  startLiveBroadcast(io);

  return io;
}

/** Live log stream detach functions keyed by server id. */
const streamDetachers = new Map<string, () => void>();

async function maybeDetach(io: SocketIOServer, serverId: string): Promise<void> {
  const sockets = await io.in(room(serverId)).fetchSockets();
  if (sockets.length > 0) return;
  const detach = streamDetachers.get(serverId);
  if (detach) {
    detach();
    streamDetachers.delete(serverId);
  }
}
