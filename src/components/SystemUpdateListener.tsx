import { useEffect } from 'react';
import { useToast, useSocketNotifications } from '@/context/ToastContext';
import { getSocket } from '@/lib/socket';

export function SystemUpdateListener() {
  const { notify } = useToast();
  useSocketNotifications({ on: getSocket().on.bind(getSocket()), off: getSocket().off.bind(getSocket()) });

  useEffect(() => {
    const socket = getSocket();
    const handler = (payload: { title?: string; message?: string; level?: 'info' | 'success' | 'warn' | 'error' }) => {
      if (payload?.title) {
        notify({ title: payload.title, message: payload.message, level: payload.level ?? 'info' });
      }
    };
    socket.on('systemUpdate', handler);
    return () => {
      socket.off('systemUpdate', handler);
    };
  }, [notify]);

  return null;
}
