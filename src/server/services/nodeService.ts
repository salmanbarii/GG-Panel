import os from 'node:os';
import { v4 as uuid } from 'uuid';
import type { CustomNode, PanelNode, SystemStats, WingsNode } from '../../types/index.js';
import { FILES, readJSON, updateJSON } from '../utils/jsonStore.js';
import { DATA_DIR } from '../utils/paths.js';
import { diskUsage } from '../utils/fsUtils.js';
import { config } from '../utils/config.js';
import { isDockerAvailable } from '../runtime/docker.js';
import { listServers } from './serverStore.js';
import { listWingsNodes, wingsHealth } from '../runtime/wings.js';

/**
 * Node inventory. The panel host itself is always exposed as a synthetic
 * "Built-in Node (Local)" with real `os` statistics.
 */

let lastCpuSample = { idle: 0, total: 0, ts: 0 };

/** Instantaneous CPU load, measured as the delta between two /proc samples. */
export function cpuPercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const [type, value] of Object.entries(cpu.times)) {
      total += value;
      if (type === 'idle') idle += value;
    }
  }

  const prev = lastCpuSample;
  lastCpuSample = { idle, total, ts: Date.now() };

  if (!prev.total || total === prev.total) {
    // First call — fall back to the 1 minute load average.
    const load = os.loadavg()[0];
    return Number(Math.min(100, (load / cpus.length) * 100).toFixed(1));
  }

  const idleDelta = idle - prev.idle;
  const totalDelta = total - prev.total;
  const used = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
  return Number(Math.max(0, Math.min(100, used)).toFixed(1));
}

export async function systemStats(): Promise<SystemStats> {
  const disk = await diskUsage(DATA_DIR);
  const totalMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMb = Math.round(os.freemem() / 1024 / 1024);
  return {
    cpuPercent: cpuPercent(),
    cpuCores: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    loadAverage: os.loadavg().map((n) => Number(n.toFixed(2))),
    ramTotalMb: totalMb,
    ramFreeMb: freeMb,
    ramUsedMb: totalMb - freeMb,
    diskTotalGb: disk.totalGb,
    diskFreeGb: disk.freeGb,
    diskUsedGb: disk.usedGb,
    uptimeSeconds: Math.round(os.uptime()),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
    panelVersion: config.panelVersion,
    dockerAvailable: await isDockerAvailable(),
  };
}

export async function localNode(): Promise<PanelNode> {
  const stats = await systemStats();
  const servers = await listServers();
  return {
    id: 'local',
    name: 'Built-in Node (Local)',
    kind: 'local',
    hostname: stats.hostname,
    port: config.port,
    online: true,
    serversCount: servers.filter((s) => !s.nodeId || s.nodeId === 'local').length,
    cpuPercent: stats.cpuPercent,
    cpuCores: stats.cpuCores,
    ramTotalMb: stats.ramTotalMb,
    ramUsedMb: stats.ramUsedMb,
    diskTotalGb: stats.diskTotalGb,
    diskUsedGb: stats.diskUsedGb,
    uptimeSeconds: stats.uptimeSeconds,
    platform: stats.platform,
    version: stats.panelVersion,
  };
}

export async function listCustomNodes(): Promise<CustomNode[]> {
  return readJSON<CustomNode[]>(FILES.nodes, []);
}

export async function addCustomNode(input: {
  name: string;
  hostname: string;
  port?: number;
}): Promise<CustomNode> {
  if (!input.name?.trim() || !input.hostname?.trim()) {
    throw Object.assign(new Error('Name and hostname are required'), { statusCode: 400 });
  }
  const node: CustomNode = {
    id: uuid(),
    name: input.name.trim(),
    hostname: input.hostname.trim(),
    port: input.port,
    createdAt: new Date().toISOString(),
  };
  await updateJSON<CustomNode[]>(FILES.nodes, [], (current) => [...current, node]);
  return node;
}

export async function deleteCustomNode(id: string): Promise<void> {
  const nodes = await listCustomNodes();
  if (!nodes.some((n) => n.id === id)) {
    throw Object.assign(new Error('Node not found'), { statusCode: 404 });
  }
  await updateJSON<CustomNode[]>(FILES.nodes, [], (current) => current.filter((n) => n.id !== id));
}

export async function addWingsNode(input: {
  name: string;
  url: string;
  token: string;
}): Promise<WingsNode> {
  if (!input.name?.trim() || !input.url?.trim() || !input.token?.trim()) {
    throw Object.assign(new Error('Name, URL and token are required'), { statusCode: 400 });
  }
  const node: WingsNode = {
    id: uuid(),
    name: input.name.trim(),
    url: input.url.trim().replace(/\/+$/, ''),
    token: input.token.trim(),
    createdAt: new Date().toISOString(),
  };
  await updateJSON<WingsNode[]>(FILES.wingsNodes, [], (current) => [...current, node]);
  return node;
}

export async function deleteWingsNode(id: string): Promise<void> {
  const nodes = await listWingsNodes();
  if (!nodes.some((n) => n.id === id)) {
    throw Object.assign(new Error('Wings node not found'), { statusCode: 404 });
  }
  const servers = await listServers();
  if (servers.some((s) => s.nodeId === id)) {
    throw Object.assign(new Error('Node still has servers assigned to it'), { statusCode: 409 });
  }
  await updateJSON<WingsNode[]>(FILES.wingsNodes, [], (current) => current.filter((n) => n.id !== id));
}

/** Full node list: built-in local node + Wings daemons + custom entries. */
export async function listAllNodes(): Promise<PanelNode[]> {
  const [local, wings, custom, servers] = await Promise.all([
    localNode(),
    listWingsNodes(),
    listCustomNodes(),
    listServers(),
  ]);

  const wingsNodes: PanelNode[] = await Promise.all(
    wings.map(async (node) => {
      const health = await wingsHealth(node);
      const system = (health.system ?? {}) as {
        cpu_count?: number;
        memory_total?: number;
        memory_used?: number;
        disk_total?: number;
        disk_used?: number;
      };
      let hostname = node.url;
      try {
        hostname = new URL(node.url).hostname;
      } catch {
        /* keep the raw url */
      }
      return {
        id: node.id,
        name: node.name,
        kind: 'wings' as const,
        hostname,
        online: health.online,
        serversCount: servers.filter((s) => s.nodeId === node.id).length,
        cpuPercent: 0,
        cpuCores: system.cpu_count ?? 0,
        ramTotalMb: Math.round((system.memory_total ?? 0) / 1024 / 1024),
        ramUsedMb: Math.round((system.memory_used ?? 0) / 1024 / 1024),
        diskTotalGb: Number(((system.disk_total ?? 0) / 1024 ** 3).toFixed(1)),
        diskUsedGb: Number(((system.disk_used ?? 0) / 1024 ** 3).toFixed(1)),
        version: health.version,
        createdAt: node.createdAt,
      };
    }),
  );

  const customNodes: PanelNode[] = custom.map((node) => ({
    id: node.id,
    name: node.name,
    kind: 'custom',
    hostname: node.hostname,
    port: node.port,
    online: true,
    serversCount: servers.filter((s) => s.nodeId === node.id).length,
    cpuPercent: 0,
    cpuCores: 0,
    ramTotalMb: 0,
    ramUsedMb: 0,
    diskTotalGb: 0,
    diskUsedGb: 0,
    createdAt: node.createdAt,
  }));

  return [local, ...wingsNodes, ...customNodes];
}
