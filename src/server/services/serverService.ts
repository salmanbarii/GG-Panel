import fs from 'fs-extra';
import path from 'node:path';
import net from 'node:net';
import { v4 as uuid } from 'uuid';
import type {
  CreateServerRequest,
  GameServer,
  GameServerView,
  JavaVersion,
  MinecraftServerType,
  RuntimeType,
  ServerStats,
  ServerStatus,
} from '../../types/index.js';
import { serverBackupDir, serverDir } from '../utils/paths.js';
import { httpError } from '../utils/http.js';
import { emitInstall, emitStatus } from '../utils/panelEvents.js';
import { getRuntime, getRuntimeByType } from '../runtime/runtimeFactory.js';
import { isWingsNode } from '../runtime/wings.js';
import {
  applyPortToProperties,
  downloadServerJar,
  resolveJavaVersion,
  writeInitialConfig,
} from './jarDownloader.js';
import {
  findServer,
  isPortTaken,
  listServers,
  patchServer,
  removeServer,
  saveServer,
  suggestPort,
} from './serverStore.js';
import { resolveRuntimeChoice } from './settingsStore.js';
import { deleteSftpUser, upsertSftpUser } from './sftp.js';
import { listUsers } from './userStore.js';
import { config } from '../utils/config.js';
import { stopTunnel } from './playitService.js';

/** Creation, deletion, migration and status resolution for game servers. */

const VALID_SERVER_TYPES: MinecraftServerType[] = [
  'vanilla',
  'paper',
  'purpur',
  'fabric',
  'forge',
  'neoforge',
  'spigot',
  'bungeecord',
  'waterfall',
  'velocity',
];

const VALID_JAVA: JavaVersion[] = ['8', '11', '16', '17', '21', 'auto'];

/** True when something is already bound to the port on the host. */
export async function isPortBusyOnHost(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE'))
      .once('listening', () => tester.close(() => resolve(false)))
      .listen(port, '0.0.0.0');
  });
}

export async function checkPort(port: number, ignoreServerId?: string) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw httpError(400, 'Port must be between 1024 and 65535');
  }
  const [takenByPanel, busyOnHost] = await Promise.all([
    isPortTaken(port, ignoreServerId),
    isPortBusyOnHost(port),
  ]);
  return {
    port,
    available: !takenByPanel && !busyOnHost,
    takenByPanel,
    busyOnHost,
    suggestion: takenByPanel || busyOnHost ? await suggestPort(port + 1) : port,
  };
}

/** Attach live runtime status + connect address to a stored server. */
export async function toView(
  server: GameServer,
  options?: { usernames?: Map<string, string>; skipStatus?: boolean },
): Promise<GameServerView> {
  let status: ServerStatus = server.status;
  if (!options?.skipStatus) {
    try {
      const runtime = await getRuntime(server);
      status = await runtime.getStatus(server);
    } catch {
      status = 'offline';
    }
  }

  const host = server.ipAlias?.trim() || config.publicHost || '';
  return {
    ...server,
    status,
    isRunning: status === 'online' || status === 'starting',
    ownerUsername: options?.usernames?.get(server.owner),
    connectAddress: host ? `${host}:${server.port}` : `:${server.port}`,
  };
}

export async function toViews(servers: GameServer[]): Promise<GameServerView[]> {
  const users = await listUsers();
  const usernames = new Map(users.map((u) => [u.id, u.username]));
  return Promise.all(servers.map((server) => toView(server, { usernames })));
}

function validateCreate(input: CreateServerRequest) {
  const name = String(input.name ?? '').trim();
  if (name.length < 2) throw httpError(400, 'Server name must be at least 2 characters');
  if (name.length > 60) throw httpError(400, 'Server name must be 60 characters or fewer');

  const ram = Number(input.ram);
  if (!Number.isFinite(ram) || ram < 0.5 || ram > 512) {
    throw httpError(400, 'RAM must be between 0.5 and 512 GB');
  }

  const cpu = Number(input.cpu);
  if (!Number.isFinite(cpu) || cpu < 10 || cpu > 1600) {
    throw httpError(400, 'CPU must be between 10% and 1600%');
  }

  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw httpError(400, 'Port must be between 1024 and 65535');
  }

  const serverType = (input.serverType ?? 'vanilla') as MinecraftServerType;
  if (!VALID_SERVER_TYPES.includes(serverType)) {
    throw httpError(400, `Unsupported server software: ${serverType}`);
  }

  const javaVersion = (input.javaVersion ?? 'auto') as JavaVersion;
  if (!VALID_JAVA.includes(javaVersion)) {
    throw httpError(400, `Unsupported Java version: ${javaVersion}`);
  }

  return { name, ram, cpu, port, serverType, javaVersion };
}

export interface CreateServerResult {
  server: GameServer;
  warnings: string[];
}

/**
 * Provision a new server: validate, reserve the port, write config, download the
 * jar, create the runtime object and an SFTP account.
 */
export async function createServer(
  input: CreateServerRequest,
  ownerId: string,
): Promise<CreateServerResult> {
  const { name, ram, cpu, port, serverType, javaVersion } = validateCreate(input);
  const warnings: string[] = [];

  const portCheck = await checkPort(port);
  if (portCheck.takenByPanel) {
    throw httpError(409, `Port ${port} is already used by another server (try ${portCheck.suggestion})`);
  }
  if (portCheck.busyOnHost) {
    warnings.push(`Port ${port} is currently in use on the host — the server may fail to bind.`);
  }

  const nodeId = String(input.nodeId ?? 'local');
  const isWings = await isWingsNode(nodeId);
  const runtimeType: RuntimeType = isWings
    ? 'wings'
    : await resolveRuntimeChoice(input.runtimeType);

  const version = String(input.version ?? '').trim() || 'latest';
  const resolvedJava = await resolveJavaVersion(javaVersion, version).catch(() => '21' as const);

  const server: GameServer = {
    id: uuid(),
    name,
    type: input.type === 'generic' ? 'generic' : 'minecraft',
    serverType,
    version,
    javaVersion: javaVersion === 'auto' ? resolvedJava : javaVersion,
    ram,
    cpu,
    port,
    owner: ownerId,
    runtimeType,
    nodeId,
    status: 'installing',
    suspended: false,
    ipAlias: '',
    iconUrl: String(input.iconUrl ?? ''),
    subUsers: [],
    createdAt: new Date().toISOString(),
  };

  await fs.ensureDir(serverDir(server.id));
  await fs.ensureDir(serverBackupDir(server.id));
  await saveServer(server);

  try {
    emitInstall(server.id, `Creating "${name}" (${serverType} ${version})…\n`);
    await writeInitialConfig({
      serverId: server.id,
      name: server.name,
      port: server.port,
      serverType: server.serverType,
    });

    // The Docker image downloads the jar itself; local + wings need it up front.
    if (runtimeType !== 'docker' && server.type === 'minecraft') {
      await downloadServerJar({
        serverId: server.id,
        serverType: server.serverType,
        version: server.version,
      });
    }

    const runtime = getRuntimeByType(runtimeType);
    const { containerId } = await runtime.createServer(server);

    const credentials = await upsertSftpUser(server.id, server.name);
    emitInstall(server.id, `SFTP account created (${credentials.username})\n`);

    const finalized = await patchServer(server.id, {
      containerId,
      status: 'offline',
    });

    emitInstall(server.id, 'Installation complete.\n', true);
    emitStatus(server.id, 'offline');
    return { server: finalized, warnings };
  } catch (err) {
    // Roll back so a failed install never leaves a ghost server behind.
    const message = err instanceof Error ? err.message : 'Installation failed';
    emitInstall(server.id, `Installation failed: ${message}\n`, true);
    await deleteServer(server.id, { keepFiles: false }).catch(() => undefined);
    throw httpError((err as { statusCode?: number }).statusCode ?? 500, message);
  }
}

export interface DeleteServerOptions {
  keepFiles?: boolean;
  keepBackups?: boolean;
}

export async function deleteServer(id: string, options: DeleteServerOptions = {}): Promise<void> {
  const server = await findServer(id);
  if (!server) throw httpError(404, 'Server not found');

  try {
    const runtime = await getRuntime(server);
    await runtime.stopServer(server).catch(() => undefined);
    await runtime.deleteServer(server);
  } catch {
    /* runtime already gone — continue with the cleanup */
  }

  await stopTunnel(id).catch(() => undefined);
  await deleteSftpUser(id).catch(() => undefined);

  if (!options.keepFiles) await fs.remove(serverDir(id)).catch(() => undefined);
  if (!options.keepBackups) await fs.remove(serverBackupDir(id)).catch(() => undefined);

  await removeServer(id);
}

export async function startServer(server: GameServer): Promise<void> {
  if (server.suspended) throw httpError(423, 'Suspended servers cannot be started');
  const runtime = await getRuntime(server);
  await runtime.startServer(server);
  await patchServer(server.id, { status: 'online' });
}

export async function stopServer(server: GameServer): Promise<void> {
  const runtime = await getRuntime(server);
  await runtime.stopServer(server);
  await patchServer(server.id, { status: 'offline' });
}

export async function restartServer(server: GameServer): Promise<void> {
  if (server.suspended) throw httpError(423, 'Suspended servers cannot be restarted');
  const runtime = await getRuntime(server);
  await runtime.restartServer(server);
  await patchServer(server.id, { status: 'online' });
}

export async function sendCommand(server: GameServer, command: string): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) throw httpError(400, 'A command is required');
  const runtime = await getRuntime(server);
  await runtime.sendCommand(server, trimmed);
}

export async function getStats(server: GameServer): Promise<ServerStats> {
  const runtime = await getRuntime(server);
  return runtime.getStats(server);
}

export async function getLogs(server: GameServer, lines = 300): Promise<string> {
  const runtime = await getRuntime(server);
  return runtime.getLogs(server, lines);
}

/** Update RAM/CPU. Docker needs the container recreated for new hard limits. */
export async function updateResources(
  server: GameServer,
  input: { ram?: number; cpu?: number },
): Promise<GameServer> {
  const ram = input.ram === undefined ? server.ram : Number(input.ram);
  const cpu = input.cpu === undefined ? server.cpu : Number(input.cpu);

  if (!Number.isFinite(ram) || ram < 0.5 || ram > 512) {
    throw httpError(400, 'RAM must be between 0.5 and 512 GB');
  }
  if (!Number.isFinite(cpu) || cpu < 10 || cpu > 1600) {
    throw httpError(400, 'CPU must be between 10% and 1600%');
  }

  const updated = await patchServer(server.id, { ram, cpu });

  if (updated.runtimeType === 'docker') {
    // Recreate the container so Memory/NanoCpus are applied.
    const runtime = getRuntimeByType('docker');
    const wasRunning = (await runtime.getStatus(updated)) === 'online';
    await runtime.stopServer(updated).catch(() => undefined);
    await runtime.deleteServer(updated).catch(() => undefined);
    const { containerId } = await runtime.createServer(updated);
    const withContainer = await patchServer(updated.id, { containerId });
    if (wasRunning) await runtime.startServer(withContainer);
    return withContainer;
  }

  return updated;
}

/** Change the Minecraft/software version and re-download the jar. */
export async function changeVersion(
  server: GameServer,
  input: { version?: string; serverType?: MinecraftServerType; javaVersion?: JavaVersion },
): Promise<GameServer> {
  const version = String(input.version ?? server.version).trim();
  const serverType = (input.serverType ?? server.serverType) as MinecraftServerType;
  if (!VALID_SERVER_TYPES.includes(serverType)) {
    throw httpError(400, `Unsupported server software: ${serverType}`);
  }

  const runtime = await getRuntime(server);
  const wasRunning = (await runtime.getStatus(server)) === 'online';
  if (wasRunning) await runtime.stopServer(server);

  const javaVersion = await resolveJavaVersion(input.javaVersion ?? 'auto', version);
  let updated = await patchServer(server.id, { version, serverType, javaVersion, status: 'installing' });

  emitInstall(server.id, `Switching to ${serverType} ${version}…\n`);

  if (updated.runtimeType === 'docker') {
    // Env vars carry TYPE/VERSION, so recreate the container.
    await runtime.deleteServer(updated).catch(() => undefined);
    const { containerId } = await getRuntimeByType('docker').createServer(updated);
    updated = await patchServer(updated.id, { containerId });
  } else if (updated.type === 'minecraft') {
    await downloadServerJar({ serverId: updated.id, serverType, version });
  }

  updated = await patchServer(updated.id, { status: 'offline' });
  emitInstall(server.id, 'Version change complete.\n', true);

  if (wasRunning) await startServer(updated).catch(() => undefined);
  return updated;
}

/** Re-download the server jar without touching worlds or config. */
export async function redownloadJar(server: GameServer): Promise<GameServer> {
  const runtime = await getRuntime(server);
  const wasRunning = (await runtime.getStatus(server)) === 'online';
  if (wasRunning) await runtime.stopServer(server);

  await patchServer(server.id, { status: 'installing' });

  if (server.runtimeType === 'docker') {
    await runtime.deleteServer(server).catch(() => undefined);
    const { containerId } = await getRuntimeByType('docker').createServer(server);
    await patchServer(server.id, { containerId });
  } else {
    await fs.remove(path.join(serverDir(server.id), 'server.jar')).catch(() => undefined);
    await downloadServerJar({
      serverId: server.id,
      serverType: server.serverType,
      version: server.version,
    });
  }

  const updated = await patchServer(server.id, { status: 'offline' });
  if (wasRunning) await startServer(updated).catch(() => undefined);
  return updated;
}

/** Move a server between the Docker and local runtimes, keeping its files. */
export async function migrateRuntime(
  server: GameServer,
  target: RuntimeType,
): Promise<GameServer> {
  if (target !== 'docker' && target !== 'local') {
    throw httpError(400, 'Runtime must be "docker" or "local"');
  }
  if (server.runtimeType === target) return server;

  const current = await getRuntime(server);
  const wasRunning = (await current.getStatus(server)) === 'online';

  await current.stopServer(server).catch(() => undefined);
  await current.deleteServer(server).catch(() => undefined);

  const migrated = await patchServer(server.id, {
    runtimeType: target,
    nodeId: 'local',
    containerId: undefined,
    status: 'offline',
  });

  const next = getRuntimeByType(target);

  if (target === 'local' && migrated.type === 'minecraft') {
    // The Docker image managed the jar; make sure a local one exists.
    const jarPath = path.join(serverDir(migrated.id), 'server.jar');
    if (!(await fs.pathExists(jarPath))) {
      await downloadServerJar({
        serverId: migrated.id,
        serverType: migrated.serverType,
        version: migrated.version,
      });
    }
  }

  const { containerId } = await next.createServer(migrated);
  const finalized = await patchServer(migrated.id, { containerId, status: 'offline' });

  if (wasRunning) await startServer(finalized).catch(() => undefined);
  return finalized;
}

/** Rename / reconfigure the basics. Port changes rewrite server.properties. */
export async function updateSettings(
  server: GameServer,
  input: { name?: string; port?: number; iconUrl?: string; ipAlias?: string },
): Promise<GameServer> {
  const patch: Partial<GameServer> = {};

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (name.length < 2) throw httpError(400, 'Server name must be at least 2 characters');
    patch.name = name;
  }

  if (input.iconUrl !== undefined) patch.iconUrl = String(input.iconUrl);
  if (input.ipAlias !== undefined) patch.ipAlias = String(input.ipAlias).trim();

  let portChanged = false;
  if (input.port !== undefined && Number(input.port) !== server.port) {
    const port = Number(input.port);
    const check = await checkPort(port, server.id);
    if (check.takenByPanel) {
      throw httpError(409, `Port ${port} is already used by another server`);
    }
    patch.port = port;
    portChanged = true;
  }

  let updated = await patchServer(server.id, patch);

  if (portChanged) {
    await applyPortToProperties(updated.id, updated.port);
    if (updated.runtimeType === 'docker') {
      // Port bindings are baked into the container.
      const runtime = getRuntimeByType('docker');
      const wasRunning = (await runtime.getStatus(updated)) === 'online';
      await runtime.stopServer(updated).catch(() => undefined);
      await runtime.deleteServer(updated).catch(() => undefined);
      const { containerId } = await runtime.createServer(updated);
      updated = await patchServer(updated.id, { containerId });
      if (wasRunning) await runtime.startServer(updated);
    }
  }

  return updated;
}

export async function setSuspended(server: GameServer, suspended: boolean): Promise<GameServer> {
  if (suspended) {
    const runtime = await getRuntime(server);
    await runtime.stopServer(server).catch(() => undefined);
  }
  return patchServer(server.id, { suspended, status: suspended ? 'offline' : server.status });
}

export async function reassignOwner(server: GameServer, newOwnerId: string): Promise<GameServer> {
  const users = await listUsers();
  if (!users.some((u) => u.id === newOwnerId)) throw httpError(404, 'Target user not found');
  return patchServer(server.id, { owner: newOwnerId });
}

/** Aggregate counters used by the dashboard. */
export async function panelTotals() {
  const servers = await listServers();
  const views = await Promise.all(servers.map((s) => toView(s)));
  return {
    totalServers: servers.length,
    runningServers: views.filter((v) => v.isRunning).length,
    totalRamGb: servers.reduce((sum, s) => sum + s.ram, 0),
    totalCpuPercent: servers.reduce((sum, s) => sum + s.cpu, 0),
    suspended: servers.filter((s) => s.suspended).length,
  };
}
