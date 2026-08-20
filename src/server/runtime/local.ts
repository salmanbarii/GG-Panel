import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import pidusage from 'pidusage';
import type { GameServer, JavaVersion, ServerStats, ServerStatus } from '../../types/index.js';
import { LOGS_DIR, serverDir } from '../utils/paths.js';
import { emitLog, emitStatus } from '../utils/panelEvents.js';
import { downloadServerJar, writeInitialConfig } from '../services/jarDownloader.js';
import { dirSizeGb } from '../utils/fsUtils.js';
import { emptyStats, type RuntimeProvider } from './types.js';

/**
 * Local runtime: plain `java -jar` child processes on the host, no containers.
 * A registry keeps the live handles so console input, log streaming and stats
 * survive across HTTP requests.
 */

interface ProcessEntry {
  pid: number;
  child: ChildProcessWithoutNullStreams;
  logPath: string;
  startedAt: number;
  stopping: boolean;
}

const registry = new Map<string, ProcessEntry>();

const JAVA_CANDIDATES: Record<Exclude<JavaVersion, 'auto'>, string[]> = {
  '8': [
    '/usr/lib/jvm/java-8-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-1.8.0-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-8-openjdk/bin/java',
  ],
  '11': [
    '/usr/lib/jvm/java-11-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-11-openjdk/bin/java',
  ],
  '16': [
    '/usr/lib/jvm/java-16-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-17-openjdk-amd64/bin/java',
  ],
  '17': [
    '/usr/lib/jvm/java-17-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-17-openjdk/bin/java',
  ],
  '21': [
    '/usr/lib/jvm/java-21-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-21-openjdk/bin/java',
  ],
};

/** Resolve the java binary for a server, falling back to whatever is on PATH. */
export async function resolveJavaBinary(javaVersion: JavaVersion): Promise<string> {
  const key = (javaVersion === 'auto' ? '21' : javaVersion) as Exclude<JavaVersion, 'auto'>;
  for (const candidate of JAVA_CANDIDATES[key] ?? []) {
    if (await fs.pathExists(candidate)) return candidate;
  }
  if (process.env.JAVA_HOME) {
    const fromHome = path.join(process.env.JAVA_HOME, 'bin', 'java');
    if (await fs.pathExists(fromHome)) return fromHome;
  }
  return 'java';
}

function logPathFor(serverId: string): string {
  return path.join(LOGS_DIR, `${serverId}.log`);
}

async function appendLog(serverId: string, chunk: string): Promise<void> {
  emitLog(serverId, chunk);
  try {
    await fs.ensureDir(LOGS_DIR);
    await fs.appendFile(logPathFor(serverId), chunk);
  } catch {
    /* logging must never break the server */
  }
}

function jvmFlags(server: GameServer): string[] {
  const maxMb = Math.max(512, Math.round(server.ram * 1024));
  const flags = [`-Xmx${maxMb}M`, '-Xms512M'];
  // Aikar-style flags help a lot for anything above 2 GB.
  if (maxMb >= 2048) {
    flags.push(
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:InitiatingHeapOccupancyPercent=15',
    );
  }
  return flags;
}

async function resolveJarName(dir: string): Promise<string> {
  if (await fs.pathExists(path.join(dir, 'server.jar'))) return 'server.jar';
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const jars = entries.filter((e) => e.endsWith('.jar') && !e.includes('installer'));
  // Forge produces run scripts + a versioned jar in libraries/
  const forgeShim = jars.find((j) => j.startsWith('forge-') || j.startsWith('neoforge-'));
  return forgeShim ?? jars[0] ?? 'server.jar';
}

/** Run the Forge/NeoForge installer once so the real launcher exists. */
async function runForgeInstaller(server: GameServer, dir: string, javaBin: string): Promise<void> {
  const installer = path.join(dir, 'forge-installer.jar');
  if (!(await fs.pathExists(installer))) return;

  await appendLog(server.id, '[panel] Running Forge installer…\n');
  await new Promise<void>((resolve) => {
    const child = spawn(javaBin, ['-jar', 'forge-installer.jar', '--installServer'], { cwd: dir });
    child.stdout.on('data', (d: Buffer) => void appendLog(server.id, d.toString()));
    child.stderr.on('data', (d: Buffer) => void appendLog(server.id, d.toString()));
    child.on('close', () => resolve());
    child.on('error', (err) => {
      void appendLog(server.id, `[panel] Installer error: ${err.message}\n`);
      resolve();
    });
  });

  await fs.remove(installer).catch(() => undefined);
}

export class LocalRuntimeProvider implements RuntimeProvider {
  readonly name = 'local' as const;

  async createServer(server: GameServer): Promise<{ containerId?: string }> {
    const dir = serverDir(server.id);
    await fs.ensureDir(dir);
    await writeInitialConfig({
      serverId: server.id,
      name: server.name,
      port: server.port,
      serverType: server.serverType,
    });
    if (server.type === 'minecraft') {
      await downloadServerJar({
        serverId: server.id,
        serverType: server.serverType,
        version: server.version,
      });
    }
    return {};
  }

  async startServer(server: GameServer): Promise<void> {
    const existing = registry.get(server.id);
    if (existing && !existing.child.killed) return;

    const dir = serverDir(server.id);
    await fs.ensureDir(dir);

    const javaBin = await resolveJavaBinary(server.javaVersion);
    await runForgeInstaller(server, dir, javaBin);

    const jarName = await resolveJarName(dir);
    if (!(await fs.pathExists(path.join(dir, jarName)))) {
      throw Object.assign(new Error('server.jar is missing — reinstall the server jar first'), {
        statusCode: 409,
      });
    }

    const args = [...jvmFlags(server), '-jar', jarName, 'nogui'];
    emitStatus(server.id, 'starting');
    await appendLog(server.id, `[panel] ${javaBin} ${args.join(' ')}\n`);

    const child = spawn(javaBin, args, {
      cwd: dir,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    const entry: ProcessEntry = {
      pid: child.pid ?? -1,
      child,
      logPath: logPathFor(server.id),
      startedAt: Date.now(),
      stopping: false,
    };
    registry.set(server.id, entry);

    child.stdout.on('data', (data: Buffer) => void appendLog(server.id, data.toString()));
    child.stderr.on('data', (data: Buffer) => void appendLog(server.id, data.toString()));

    child.on('error', (err) => {
      void appendLog(server.id, `[panel] Process error: ${err.message}\n`);
      registry.delete(server.id);
      emitStatus(server.id, 'error');
    });

    child.on('close', (code, signal) => {
      registry.delete(server.id);
      void appendLog(
        server.id,
        `[panel] Process exited (code=${code ?? 'null'} signal=${signal ?? 'none'})\n`,
      );
      emitStatus(server.id, 'offline');
    });

    // CPU limiting on the host is best-effort: renice when a low cap is requested.
    if (server.cpu > 0 && server.cpu < 100 && child.pid) {
      try {
        const nice = Math.min(19, Math.max(0, Math.round((100 - server.cpu) / 5)));
        spawn('renice', ['-n', String(nice), '-p', String(child.pid)]).on('error', () => undefined);
      } catch {
        /* renice is optional */
      }
    }

    emitStatus(server.id, 'online');
  }

  async stopServer(server: GameServer): Promise<void> {
    const entry = registry.get(server.id);
    if (!entry) {
      emitStatus(server.id, 'offline');
      return;
    }
    entry.stopping = true;
    emitStatus(server.id, 'stopping');

    const isProxy = ['bungeecord', 'waterfall', 'velocity'].includes(server.serverType);
    try {
      entry.child.stdin.write(isProxy ? 'end\n' : 'stop\n');
    } catch {
      /* pipe already closed */
    }

    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 30_000);
      entry.child.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (!exited) {
      await appendLog(server.id, '[panel] Graceful stop timed out — sending SIGKILL\n');
      try {
        entry.child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }

    registry.delete(server.id);
    emitStatus(server.id, 'offline');
  }

  async restartServer(server: GameServer): Promise<void> {
    await this.stopServer(server);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await this.startServer(server);
  }

  async deleteServer(server: GameServer): Promise<void> {
    const entry = registry.get(server.id);
    if (entry) {
      try {
        entry.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      registry.delete(server.id);
    }
    await fs.remove(logPathFor(server.id)).catch(() => undefined);
  }

  async getStatus(server: GameServer): Promise<ServerStatus> {
    const entry = registry.get(server.id);
    if (!entry) return 'offline';
    if (entry.stopping) return 'stopping';
    return entry.child.killed ? 'offline' : 'online';
  }

  async getStats(server: GameServer): Promise<ServerStats> {
    const entry = registry.get(server.id);
    const disk = await dirSizeGb(serverDir(server.id));

    if (!entry || entry.pid <= 0) {
      return { ...emptyStats(server, false), disk };
    }

    try {
      const usage = await pidusage(entry.pid);
      return {
        cpu: Number(usage.cpu.toFixed(1)),
        ram: Math.round(usage.memory / 1024 / 1024),
        ramLimit: Math.round(server.ram * 1024),
        disk,
        uptime: Math.floor((Date.now() - entry.startedAt) / 1000),
        isRunning: true,
      };
    } catch {
      return { ...emptyStats(server, false), disk };
    }
  }

  async getLogs(server: GameServer, lines = 300): Promise<string> {
    const candidates = [logPathFor(server.id), path.join(serverDir(server.id), 'logs', 'latest.log')];
    for (const file of candidates) {
      if (!(await fs.pathExists(file))) continue;
      const raw = await fs.readFile(file, 'utf8');
      return raw.split('\n').slice(-lines).join('\n');
    }
    return '';
  }

  /**
   * Live output already flows through panelEvents from the spawn handlers, so we
   * only need to tail the log file for servers that were started before the panel
   * restarted (or that write directly to logs/latest.log).
   */
  async attachSocket(server: GameServer): Promise<() => void> {
    if (registry.has(server.id)) return () => undefined;

    const file = path.join(serverDir(server.id), 'logs', 'latest.log');
    if (!(await fs.pathExists(file))) return () => undefined;

    let position = (await fs.stat(file)).size;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const stat = await fs.stat(file);
          if (stat.size <= position) {
            position = stat.size;
            return;
          }
          const stream = fs.createReadStream(file, { start: position, end: stat.size - 1 });
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(chunk as Buffer);
          position = stat.size;
          emitLog(server.id, Buffer.concat(chunks).toString('utf8'));
        } catch {
          /* file rotated */
        }
      })();
    }, 1000);

    return () => clearInterval(interval);
  }

  async sendCommand(server: GameServer, command: string): Promise<void> {
    const entry = registry.get(server.id);
    if (!entry) {
      throw Object.assign(new Error('Server is not running'), { statusCode: 409 });
    }
    entry.child.stdin.write(`${command}\n`);
    await appendLog(server.id, `> ${command}\n`);
  }
}

export const localRuntime = new LocalRuntimeProvider();

/** Used by the runtime migration flow and graceful panel shutdown. */
export function localRunningIds(): string[] {
  return [...registry.keys()];
}

export async function killAllLocalProcesses(): Promise<void> {
  for (const [, entry] of registry) {
    try {
      entry.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  registry.clear();
}
