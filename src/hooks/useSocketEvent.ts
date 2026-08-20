import { useEffect, useRef } from 'react';
import { getSocket } from '@/lib/socket';

/**
 * Subscribes to a global Socket.IO event (not scoped to a server room) for the
 * lifetime of the component. The latest handler is always used without
 * re-subscribing, so callers can pass an inline closure safely.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event, enabled]);
}
