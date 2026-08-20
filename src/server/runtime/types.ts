import type { GameServer, ServerStats, ServerStatus } from '../../types/index.js';

/**
 * Every server operation in the panel goes through this interface, so Docker
 * containers, bare host processes and remote Wings daemons are interchangeable.
 */
export interface RuntimeProvider {
  readonly name: 'docker' | 'local' | 'wings';

  /** Provision the server (create container / prepare directory + jar). */
  createServer(server: GameServer): Promise<{ containerId?: string }>;

  startServer(server: GameServer): Promise<void>;
  stopServer(server: GameServer): Promise<void>;
  restartServer(server: GameServer): Promise<void>;

  /** Remove the runtime object. Files are removed by the caller. */
  deleteServer(server: GameServer): Promise<void>;

  getStatus(server: GameServer): Promise<ServerStatus>;
  getStats(server: GameServer): Promise<ServerStats>;

  /** Recent log lines (tail). */
  getLogs(server: GameServer, lines?: number): Promise<string>;

  /** Begin streaming logs into panelEvents; returns a detach function. */
  attachSocket(server: GameServer): Promise<() => void>;

  sendCommand(server: GameServer, command: string): Promise<void>;
}

export interface RuntimeContext {
  onInstallOutput?: (chunk: string) => void;
}

export function emptyStats(server: GameServer, isRunning = false): ServerStats {
  return {
    cpu: 0,
    ram: 0,
    ramLimit: Math.round(server.ram * 1024),
    disk: 0,
    uptime: 0,
    isRunning,
  };
}
