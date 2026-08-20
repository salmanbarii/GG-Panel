import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerStatus } from '@/types';
import { getSocket } from '@/lib/socket';

/**
 * Subscribes to a server's Socket.IO room: replays history, streams live log
 * lines and tracks status changes. Log lines are kept in a ref-backed buffer and
 * flushed on a 100 ms tick so a chatty server cannot thrash React.
 */

const MAX_LINES = 3000;

export interface UseServerSocketResult {
  lines: string[];
  status: ServerStatus;
  connected: boolean;
  error: string | null;
  sendCommand: (command: string) => void;
  clear: () => void;
}

export function useServerSocket(serverId: string | undefined, enabled = true): UseServerSocketResult {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<ServerStatus>('offline');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buffer = useRef<string[]>([]);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const push = useCallback((chunk: string) => {
    const incoming = chunk.replace(/\r\n/g, '\n').split('\n');
    buffer.current.push(...incoming);
  }, []);

  useEffect(() => {
    if (!serverId || !enabled) return;

    const socket = getSocket();
    setConnected(socket.connected);

    const onConnect = () => {
      setConnected(true);
      setError(null);
      socket.emit('joinServer', serverId);
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => setError(err.message);

    const onHistory = (payload: { serverId: string; data: string }) => {
      if (payload.serverId !== serverId) return;
      const historyLines = payload.data.replace(/\r\n/g, '\n').split('\n');
      setLines(historyLines.slice(-MAX_LINES));
    };

    const onLog = (payload: { serverId: string; data: string }) => {
      if (payload.serverId !== serverId) return;
      push(payload.data);
    };

    const onInstall = (payload: { serverId: string; data: string }) => {
      if (payload.serverId !== serverId) return;
      push(payload.data);
    };

    const onStatus = (payload: { serverId: string; status: ServerStatus }) => {
      if (payload.serverId !== serverId) return;
      setStatus(payload.status);
    };

    const onServerError = (payload: { serverId: string; error: string }) => {
      if (payload.serverId && payload.serverId !== serverId) return;
      setError(payload.error);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('logHistory', onHistory);
    socket.on('log', onLog);
    socket.on('install', onInstall);
    socket.on('status', onStatus);
    socket.on('serverError', onServerError);

    if (socket.connected) socket.emit('joinServer', serverId);

    flushTimer.current = setInterval(() => {
      if (!buffer.current.length) return;
      const pending = buffer.current;
      buffer.current = [];
      setLines((current) => [...current, ...pending].slice(-MAX_LINES));
    }, 100);

    return () => {
      socket.emit('leaveServer', serverId);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('logHistory', onHistory);
      socket.off('log', onLog);
      socket.off('install', onInstall);
      socket.off('status', onStatus);
      socket.off('serverError', onServerError);
      if (flushTimer.current) clearInterval(flushTimer.current);
      buffer.current = [];
    };
  }, [serverId, enabled, push]);

  const sendCommand = useCallback(
    (command: string) => {
      if (!serverId || !command.trim()) return;
      getSocket().emit('command', { serverId, command });
    },
    [serverId],
  );

  const clear = useCallback(() => {
    buffer.current = [];
    setLines([]);
  }, []);

  return { lines, status, connected, error, sendCommand, clear };
}
