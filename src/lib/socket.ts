import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';

/**
 * One shared Socket.IO connection for the whole app. Components subscribe to
 * rooms through `useServerSocket`, and the connection is torn down on logout.
 */

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket && socket.connected) return socket;
  if (socket) {
    socket.auth = { token: getToken() };
    socket.connect();
    return socket;
  }

  socket = io({
    path: '/socket.io',
    auth: { token: getToken() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Number.POSITIVE_INFINITY,
    reconnectionDelay: 800,
    reconnectionDelayMax: 6000,
  });

  return socket;
}

export function refreshSocketAuth(): void {
  if (!socket) return;
  socket.auth = { token: getToken() };
  if (socket.connected) socket.disconnect();
  socket.connect();
}

export function closeSocket(): void {
  socket?.close();
  socket = null;
}
