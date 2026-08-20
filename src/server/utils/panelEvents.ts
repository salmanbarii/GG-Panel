import { EventEmitter } from 'node:events';
import type { NotificationPayload, ServerStatus, UpdateStatus } from '../../types/index.js';

/**
 * Decouples the runtime providers from Socket.IO. Runtimes emit events here and
 * `src/server/socket.ts` fans them out to the matching `server_<id>` room.
 */
export interface PanelEventMap {
  log: { serverId: string; data: string };
  status: { serverId: string; status: ServerStatus };
  stats: { serverId: string; cpu: number; ram: number };
  install: { serverId: string; data: string; done?: boolean };
  systemUpdate: UpdateStatus;
  notification: NotificationPayload;
}

class PanelEvents extends EventEmitter {
  emitTyped<K extends keyof PanelEventMap>(event: K, payload: PanelEventMap[K]): boolean {
    return this.emit(event, payload);
  }

  onTyped<K extends keyof PanelEventMap>(
    event: K,
    listener: (payload: PanelEventMap[K]) => void,
  ): this {
    return this.on(event, listener as (...args: unknown[]) => void);
  }

  offTyped<K extends keyof PanelEventMap>(
    event: K,
    listener: (payload: PanelEventMap[K]) => void,
  ): this {
    return this.off(event, listener as (...args: unknown[]) => void);
  }
}

export const panelEvents = new PanelEvents();
// Many servers can stream at once; avoid the default max-listener warning.
panelEvents.setMaxListeners(0);

export function emitLog(serverId: string, data: string): void {
  panelEvents.emitTyped('log', { serverId, data });
}

export function emitStatus(serverId: string, status: ServerStatus): void {
  panelEvents.emitTyped('status', { serverId, status });
}

export function emitInstall(serverId: string, data: string, done = false): void {
  panelEvents.emitTyped('install', { serverId, data, done });
}
