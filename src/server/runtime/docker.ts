import Docker from 'dockerode';
import fs from 'fs-extra';
import type { Duplex } from 'node:stream';
import type { GameServer, ServerStats, ServerStatus } from '../../types/index.js';
import { serverDir } from '../utils/paths.js';
import { config } from '../utils/config.js';
import { emitInstall, emitLog, emitStatus } from '../utils/panelEvents.js';
import { dirSizeGb } from '../utils/fsUtils.js';
import { resolveJavaVersion, writeInitialConfig } from '../services/jarDownloader.js';
import { emptyStats, type RuntimeProvider } from './types.js';

/**
 * Docker runtime backed by `itzg/minecraft-server`, which handles jar provisioning,
 * EULA acceptance and JVM tuning through environment variables.
 */

let docker: Docker | null = null;
let dockerAvailable: boolean | null = null;

export function getDocker(): Docker {
  if (!docker) {
    docker = new Docker(
      config.dockerSocketPath.startsWith('/')
        ? { socketPath: config.dockerSocketPath }
        : { host: config.dockerSocketPath },
    );
  }
  return docker;
}

export async function isDockerAvailable(force = false): Promise<boolean> {
  if (!config.enableDocker) return false;
  if (dockerAvailable !== null && !force) return dockerAvailable;
  try {
    await getDocker().ping();
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

export function containerName(server: GameServer): string {
  return `jtg-${server.id.slice(0, 12)}`;
}

/** itzg/minecraft-server TYPE value for each supported software. */
function imageTypeFor(server: GameServer): string {
  const map: Record<string, string> = {
    vanilla: 'VANILLA',
    paper: 'PAPER',
    purpur: 'PURPUR',
    fabric: 'FABRIC',
    forge: 'FORGE',
    neoforge: 'NEOFORGE',
    spigot: 'SPIGOT',
    bungeecord: 'BUNGEECORD',
    waterfall: 'WATERFALL',
    velocity: 'VELOCITY',
  };
  return map[server.serverType] ?? 'VANILLA';
}

async function buildEnv(server: GameServer): Promise<string[]> {
  const java = await resolveJavaVersion(server.javaVersion, server.version);
  const memoryMb = Math.max(512, Math.round(server.ram * 1024));

  const env: Record<string, string> = {
    EULA: 'TRUE',
    TYPE: imageTypeFor(server),
    VERSION: server.version,
    MEMORY: `${memoryMb}M`,
    INIT_MEMORY: '512M',
    MAX_MEMORY: `${memoryMb}M`,
    SERVER_PORT: String(server.port),
    ENABLE_RCON: 'true',
    RCON_PASSWORD: 'jtgpanel',
    RCON_PORT: String(server.port + 10),
    MOTD: `${server.name} — powered by JTG Panel`,
    OVERRIDE_SERVER_PROPERTIES: 'false',
    SKIP_SUDO: 'true',
    UID: String(process.getuid?.() ?? 1000),
    GID: String(process.getgid?.() ?? 1000),
    // Pin the JRE the image runs with.
    JAVA_VERSION: java,
    VANILLA_VERSION: server.version,
  };

  if (['bungeecord', 'waterfall', 'velocity'].includes(server.serverType)) {
    delete env.EULA;
    delete env.RCON_PASSWORD;
    env.ENABLE_RCON = 'false';
  }

  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

async function findContainer(server: GameServer) {
  const client = getDocker();
  if (server.containerId) {
    try {
      const container = client.getContainer(server.containerId);
      await container.inspect();
      return container;
    } catch {
      /* stale id — fall back to name lookup */
    }
  }
  const list = await client.listContainers({ all: true });
  const match = list.find((c) => c.Names.some((n) => n.replace(/^\//, '') === containerName(server)));
  return match ? client.getContainer(match.Id) : null;
}

async function pullImage(server: GameServer): Promise<void> {
  const client = getDocker();
  const image = config.dockerImage;
  emitInstall(server.id, `Pulling image ${image}…\n`);

  await new Promise<void>((resolve, reject) => {
    client.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err || !stream) {
        reject(err ?? new Error('Docker pull failed'));
        return;
      }
      client.modem.followProgress(
        stream,
        (progressErr: Error | null) => (progressErr ? reject(progressErr) : resolve()),
        (event: { status?: string; progress?: string }) => {
          if (event.status) {
            emitInstall(server.id, `${event.status}${event.progress ? ` ${event.progress}` : ''}\n`);
          }
        },
      );
    });
  });
}

export class DockerRuntimeProvider implements RuntimeProvider {
  readonly name = 'docker' as const;

  private attachments = new Map<string, () => void>();

  async createServer(server: GameServer): Promise<{ containerId?: string }> {
    if (!(await isDockerAvailable())) {
      throw Object.assign(
        new Error('Docker is not reachable. Enable Docker or use the local runtime.'),
        { statusCode: 503 },
      );
    }

    const dir = serverDir(server.id);
    await fs.ensureDir(dir);
    await writeInitialConfig({
      serverId: server.id,
      name: server.name,
      port: server.port,
      serverType: server.serverType,
    });

    await pullImage(server).catch((err: Error) => {
      emitInstall(server.id, `Image pull warning: ${err.message}\n`);
    });

    // Remove a stale container with the same name (e.g. failed earlier attempt).
    const existing = await findContainer(server);
    if (existing) {
      await existing.remove({ force: true }).catch(() => undefined);
    }

    const container = await getDocker().createContainer({
      name: containerName(server),
      Image: config.dockerImage,
      Env: await buildEnv(server),
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Labels: {
        'jtg.panel': 'true',
        'jtg.serverId': server.id,
        'jtg.serverName': server.name,
      },
      HostConfig: {
        Binds: [`${dir}:/data`],
        Memory: Math.round(server.ram * 1024 * 1024 * 1024),
        MemorySwap: Math.round(server.ram * 1024 * 1024 * 1024),
        NanoCpus: Math.max(1, Math.round((server.cpu / 100) * 1e9)),
        RestartPolicy: { Name: 'no' },
      },
    });

    emitInstall(server.id, `Container created (${container.id.slice(0, 12)})\n`, true);
    return { containerId: container.id };
  }

  async startServer(server: GameServer): Promise<void> {
    const container = await findContainer(server);
    if (!container) {
      throw Object.assign(new Error('Container missing — reinstall the server'), { statusCode: 409 });
    }
    const info = await container.inspect();
    if (info.State.Running) return;

    emitStatus(server.id, 'starting');
    await container.start();
    emitStatus(server.id, 'online');
  }

  async stopServer(server: GameServer): Promise<void> {
    const container = await findContainer(server);
    if (!container) {
      emitStatus(server.id, 'offline');
      return;
    }
    const info = await container.inspect().catch(() => null);
    if (!info?.State.Running) {
      emitStatus(server.id, 'offline');
      return;
    }

    emitStatus(server.id, 'stopping');
    // Try an in-game stop first so the world saves cleanly.
    await this.sendCommand(server, 'stop').catch(() => undefined);
    await container.stop({ t: 30 }).catch(() => undefined);
    emitStatus(server.id, 'offline');
  }

  async restartServer(server: GameServer): Promise<void> {
    const container = await findContainer(server);
    if (!container) {
      throw Object.assign(new Error('Container missing — reinstall the server'), { statusCode: 409 });
    }
    emitStatus(server.id, 'starting');
    await container.restart({ t: 30 });
    emitStatus(server.id, 'online');
  }

  async deleteServer(server: GameServer): Promise<void> {
    this.attachments.get(server.id)?.();
    this.attachments.delete(server.id);
    const container = await findContainer(server).catch(() => null);
    if (container) {
      await container.remove({ force: true, v: true }).catch(() => undefined);
    }
  }

  async getStatus(server: GameServer): Promise<ServerStatus> {
    if (!(await isDockerAvailable())) return 'offline';
    const container = await findContainer(server).catch(() => null);
    if (!container) return 'offline';
    const info = await container.inspect().catch(() => null);
    if (!info) return 'offline';
    if (info.State.Restarting) return 'starting';
    if (info.State.Running) return 'online';
    if (info.State.Dead || (info.State.ExitCode ?? 0) > 1) return 'error';
    return 'offline';
  }

  async getStats(server: GameServer): Promise<ServerStats> {
    const disk = await dirSizeGb(serverDir(server.id));
    const container = await findContainer(server).catch(() => null);
    if (!container) return { ...emptyStats(server, false), disk };

    const info = await container.inspect().catch(() => null);
    if (!info?.State.Running) return { ...emptyStats(server, false), disk };

    const raw = (await container.stats({ stream: false })) as unknown as {
      cpu_stats: {
        cpu_usage: { total_usage: number; percpu_usage?: number[] };
        system_cpu_usage?: number;
        online_cpus?: number;
      };
      precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
      memory_stats: { usage?: number; limit?: number; stats?: { cache?: number } };
    };

    const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
    const systemDelta = (raw.cpu_stats.system_cpu_usage ?? 0) - (raw.precpu_stats.system_cpu_usage ?? 0);
    const cores = raw.cpu_stats.online_cpus ?? raw.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cores * 100 : 0;

    const cache = raw.memory_stats.stats?.cache ?? 0;
    const usedBytes = Math.max(0, (raw.memory_stats.usage ?? 0) - cache);

    const startedAt = new Date(info.State.StartedAt).getTime();

    return {
      cpu: Number(cpuPercent.toFixed(1)),
      ram: Math.round(usedBytes / 1024 / 1024),
      ramLimit: Math.round(server.ram * 1024),
      disk,
      uptime: Number.isFinite(startedAt) ? Math.floor((Date.now() - startedAt) / 1000) : 0,
      isRunning: true,
    };
  }

  async getLogs(server: GameServer, lines = 300): Promise<string> {
    const container = await findContainer(server).catch(() => null);
    if (!container) return '';
    const buffer = (await container.logs({
      stdout: true,
      stderr: true,
      tail: lines,
      timestamps: false,
    })) as unknown as Buffer;
    return stripDockerFrames(buffer);
  }

  async attachSocket(server: GameServer): Promise<() => void> {
    const existing = this.attachments.get(server.id);
    if (existing) return existing;

    const container = await findContainer(server).catch(() => null);
    if (!container) return () => undefined;

    const stream = (await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: 200,
    })) as unknown as NodeJS.ReadableStream;

    const onData = (chunk: Buffer) => emitLog(server.id, stripDockerFrames(chunk));
    stream.on('data', onData);
    stream.on('error', () => undefined);

    const detach = () => {
      stream.off('data', onData);
      (stream as unknown as { destroy?: () => void }).destroy?.();
      this.attachments.delete(server.id);
    };

    this.attachments.set(server.id, detach);
    return detach;
  }

  async sendCommand(server: GameServer, command: string): Promise<void> {
    const container = await findContainer(server);
    if (!container) throw Object.assign(new Error('Container missing'), { statusCode: 409 });

    const info = await container.inspect();
    if (!info.State.Running) {
      throw Object.assign(new Error('Server is not running'), { statusCode: 409 });
    }

    // itzg images ship `rcon-cli`, which is the reliable path for console input.
    try {
      const exec = await container.exec({
        Cmd: ['rcon-cli', command],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = (await exec.start({ hijack: true, stdin: false })) as unknown as Duplex;
      const output = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(stripDockerFrames(Buffer.concat(chunks))));
        setTimeout(() => resolve(stripDockerFrames(Buffer.concat(chunks))), 5000);
      });
      emitLog(server.id, `> ${command}\n${output.trim() ? `${output.trim()}\n` : ''}`);
      return;
    } catch {
      /* rcon-cli unavailable — fall back to the attached stdin */
    }

    const stdin = (await container.attach({
      stream: true,
      stdin: true,
      stdout: false,
      stderr: false,
      hijack: true,
    })) as unknown as Duplex;
    stdin.write(`${command}\n`);
    stdin.end();
    emitLog(server.id, `> ${command}\n`);
  }
}

/**
 * Docker multiplexes stdout/stderr with an 8 byte header per frame when the
 * container has no TTY. Strip those headers so the console stays clean.
 */
function stripDockerFrames(buffer: Buffer): string {
  if (!Buffer.isBuffer(buffer)) return String(buffer ?? '');
  const parts: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const type = buffer[offset];
    const isFrameHeader =
      (type === 0 || type === 1 || type === 2) &&
      offset + 8 <= buffer.length &&
      buffer[offset + 1] === 0 &&
      buffer[offset + 2] === 0 &&
      buffer[offset + 3] === 0;

    if (!isFrameHeader) {
      parts.push(buffer.subarray(offset).toString('utf8'));
      break;
    }

    const length = buffer.readUInt32BE(offset + 4);
    parts.push(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    offset += 8 + length;
  }

  return parts.join('');
}

export const dockerRuntime = new DockerRuntimeProvider();
