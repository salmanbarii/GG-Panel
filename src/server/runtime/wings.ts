import axios, { type AxiosInstance } from 'axios';
import WebSocket from 'ws';
import type { GameServer, ServerStats, ServerStatus, WingsNode } from '../../types/index.js';
import { FILES, readJSON } from '../utils/jsonStore.js';
import { emitLog, emitStatus } from '../utils/panelEvents.js';
import { emptyStats, type RuntimeProvider } from './types.js';

/**
 * Wings runtime: proxies lifecycle calls to a remote Pterodactyl Wings daemon.
 * Auth is a Bearer token stored per node in wings_nodes.json.
 */

export async function listWingsNodes(): Promise<WingsNode[]> {
  return readJSON<WingsNode[]>(FILES.wingsNodes, []);
}

export async function findWingsNode(id: string): Promise<WingsNode | undefined> {
  return (await listWingsNodes()).find((n) => n.id === id);
}

export async function isWingsNode(nodeId: string | undefined): Promise<boolean> {
  if (!nodeId || nodeId === 'local') return false;
  return Boolean(await findWingsNode(nodeId));
}

function clientFor(node: WingsNode): AxiosInstance {
  return axios.create({
    baseURL: node.url.replace(/\/+$/, ''),
    timeout: 20_000,
    headers: {
      Authorization: `Bearer ${node.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    // Self-signed certs are the norm on private Wings nodes.
    validateStatus: () => true,
  } as never);
}

export async function wingsHealth(node: WingsNode): Promise<{
  online: boolean;
  version?: string;
  error?: string;
  system?: Record<string, unknown>;
}> {
  try {
    const client = clientFor(node);
    const res = await client.get('/api/system');
    if (res.status >= 400) {
      return { online: false, error: `HTTP ${res.status}` };
    }
    const data = res.data as { version?: string };
    return { online: true, version: data?.version, system: res.data as Record<string, unknown> };
  } catch (err) {
    return { online: false, error: err instanceof Error ? err.message : 'unreachable' };
  }
}

interface WingsResourceResponse {
  state?: string;
  utilization?: {
    memory_bytes?: number;
    memory_limit_bytes?: number;
    cpu_absolute?: number;
    disk_bytes?: number;
    uptime?: number;
  };
}

export class WingsRuntimeProvider implements RuntimeProvider {
  readonly name = 'wings' as const;

  private sockets = new Map<string, () => void>();

  private async node(server: GameServer): Promise<WingsNode> {
    const node = await findWingsNode(server.nodeId);
    if (!node) {
      throw Object.assign(new Error(`Wings node ${server.nodeId} is not configured`), {
        statusCode: 400,
      });
    }
    return node;
  }

  private uuid(server: GameServer): string {
    return server.containerId || server.id;
  }

  private async power(server: GameServer, action: 'start' | 'stop' | 'restart' | 'kill') {
    const node = await this.node(server);
    const res = await clientFor(node).post(`/api/servers/${this.uuid(server)}/power`, { action });
    if (res.status >= 400) {
      throw Object.assign(new Error(`Wings power ${action} failed (HTTP ${res.status})`), {
        statusCode: 502,
      });
    }
  }

  async createServer(server: GameServer): Promise<{ containerId?: string }> {
    const node = await this.node(server);
    const client = clientFor(node);
    const uuid = server.id;

    const res = await client.post('/api/servers', {
      uuid,
      start_on_completion: false,
      settings: {
        uuid,
        meta: { name: server.name, description: 'Created by JTG Panel' },
        suspended: false,
        invocation: `java -Xms512M -Xmx${Math.round(server.ram * 1024)}M -jar server.jar nogui`,
        skip_egg_scripts: false,
        build: {
          memory_limit: Math.round(server.ram * 1024),
          swap: 0,
          io_weight: 500,
          cpu_limit: server.cpu,
          disk_space: 10_240,
          threads: null,
        },
        container: { image: 'ghcr.io/pterodactyl/yolks:java_17' },
        allocations: {
          default: { ip: '0.0.0.0', port: server.port },
          mappings: { '0.0.0.0': [server.port] },
        },
        egg: {
          id: 'jtg-generic',
          file_denylist: [],
        },
      },
    });

    if (res.status >= 400) {
      throw Object.assign(
        new Error(`Wings rejected the server creation (HTTP ${res.status})`),
        { statusCode: 502 },
      );
    }
    return { containerId: uuid };
  }

  async startServer(server: GameServer): Promise<void> {
    emitStatus(server.id, 'starting');
    await this.power(server, 'start');
  }

  async stopServer(server: GameServer): Promise<void> {
    emitStatus(server.id, 'stopping');
    await this.power(server, 'stop');
  }

  async restartServer(server: GameServer): Promise<void> {
    emitStatus(server.id, 'starting');
    await this.power(server, 'restart');
  }

  async deleteServer(server: GameServer): Promise<void> {
    this.sockets.get(server.id)?.();
    this.sockets.delete(server.id);
    const node = await this.node(server).catch(() => null);
    if (!node) return;
    await clientFor(node)
      .delete(`/api/servers/${this.uuid(server)}`)
      .catch(() => undefined);
  }

  async getStatus(server: GameServer): Promise<ServerStatus> {
    try {
      const node = await this.node(server);
      const res = await clientFor(node).get<WingsResourceResponse>(
        `/api/servers/${this.uuid(server)}`,
      );
      if (res.status >= 400) return 'offline';
      switch (res.data?.state) {
        case 'running':
          return 'online';
        case 'starting':
          return 'starting';
        case 'stopping':
          return 'stopping';
        default:
          return 'offline';
      }
    } catch {
      return 'offline';
    }
  }

  async getStats(server: GameServer): Promise<ServerStats> {
    try {
      const node = await this.node(server);
      const res = await clientFor(node).get<WingsResourceResponse>(
        `/api/servers/${this.uuid(server)}`,
      );
      const util = res.data?.utilization ?? {};
      return {
        cpu: Number((util.cpu_absolute ?? 0).toFixed(1)),
        ram: Math.round((util.memory_bytes ?? 0) / 1024 / 1024),
        ramLimit: Math.round(server.ram * 1024),
        disk: Number(((util.disk_bytes ?? 0) / 1024 ** 3).toFixed(3)),
        uptime: Math.round((util.uptime ?? 0) / 1000),
        isRunning: res.data?.state === 'running',
      };
    } catch {
      return emptyStats(server, false);
    }
  }

  async getLogs(server: GameServer, lines = 300): Promise<string> {
    try {
      const node = await this.node(server);
      const res = await clientFor(node).get<{ data?: string[] }>(
        `/api/servers/${this.uuid(server)}/logs?size=${lines}`,
      );
      const data = res.data?.data;
      return Array.isArray(data) ? data.join('\n') : '';
    } catch {
      return '';
    }
  }

  async attachSocket(server: GameServer): Promise<() => void> {
    const existing = this.sockets.get(server.id);
    if (existing) return existing;

    const node = await this.node(server);
    const wsUrl = `${node.url.replace(/^http/, 'ws').replace(/\/+$/, '')}/api/servers/${this.uuid(
      server,
    )}/ws`;

    const socket = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${node.token}` },
      rejectUnauthorized: false,
    });

    socket.on('open', () => {
      socket.send(JSON.stringify({ event: 'auth', args: [node.token] }));
      socket.send(JSON.stringify({ event: 'send logs', args: [null] }));
    });

    socket.on('message', (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(raw.toString()) as { event: string; args?: string[] };
        if (parsed.event === 'console output' && parsed.args?.[0]) {
          emitLog(server.id, `${parsed.args[0]}\n`);
        }
        if (parsed.event === 'status' && parsed.args?.[0]) {
          const state = parsed.args[0];
          emitStatus(
            server.id,
            state === 'running'
              ? 'online'
              : state === 'starting'
                ? 'starting'
                : state === 'stopping'
                  ? 'stopping'
                  : 'offline',
          );
        }
      } catch {
        /* non-JSON frame */
      }
    });

    socket.on('error', (err: Error) => emitLog(server.id, `[wings] ${err.message}\n`));

    const detach = () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      this.sockets.delete(server.id);
    };

    this.sockets.set(server.id, detach);
    return detach;
  }

  async sendCommand(server: GameServer, command: string): Promise<void> {
    const node = await this.node(server);
    const res = await clientFor(node).post(`/api/servers/${this.uuid(server)}/commands`, {
      commands: [command],
    });
    if (res.status >= 400) {
      throw Object.assign(new Error(`Wings rejected the command (HTTP ${res.status})`), {
        statusCode: 502,
      });
    }
    emitLog(server.id, `> ${command}\n`);
  }
}

export const wingsRuntime = new WingsRuntimeProvider();
