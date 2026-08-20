import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { PlayitTunnel } from '../../types/index.js';
import { DATA_DIR } from '../utils/paths.js';
import { emitLog } from '../utils/panelEvents.js';
import { patchServer } from './serverStore.js';

/**
 * playit.gg integration — gives servers a public address without port forwarding.
 * The agent binary is downloaded on demand into `.data/playit/` and one agent
 * process is kept per server.
 */

const PLAYIT_DIR = path.join(DATA_DIR, 'playit');
const AGENT_RELEASE = 'https://github.com/playit-cloud/playit-agent/releases/latest/download';

interface AgentEntry {
  child: ChildProcess;
  tunnel: PlayitTunnel;
}

const agents = new Map<string, AgentEntry>();

function binaryName(): string {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'amd64';
  if (process.platform === 'linux') return `playit-linux-${arch}`;
  if (process.platform === 'darwin') return 'playit-darwin-intel';
  return 'playit-windows-amd64.exe';
}

export async function ensureAgentBinary(): Promise<string> {
  await fs.ensureDir(PLAYIT_DIR);
  const target = path.join(PLAYIT_DIR, binaryName());
  if (await fs.pathExists(target)) return target;

  const url = `${AGENT_RELEASE}/${binaryName()}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw Object.assign(
      new Error(`Could not download the playit.gg agent (HTTP ${res.status})`),
      { statusCode: 502 },
    );
  }

  const tmp = `${target}.part`;
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    fs.createWriteStream(tmp),
  );
  await fs.move(tmp, target, { overwrite: true });
  await fs.chmod(target, 0o755);
  return target;
}

function tunnelStatePath(serverId: string): string {
  return path.join(PLAYIT_DIR, `${serverId}.toml`);
}

export function getTunnel(serverId: string): PlayitTunnel | undefined {
  return agents.get(serverId)?.tunnel;
}

/**
 * Start (or restart) the agent for a server. The first run prints a claim URL
 * that the user must open to link the tunnel to their playit.gg account.
 */
export async function startTunnel(server: {
  id: string;
  name: string;
  port: number;
}): Promise<PlayitTunnel> {
  await stopTunnel(server.id);

  const binary = await ensureAgentBinary();
  const secretPath = tunnelStatePath(server.id);

  const child = spawn(binary, ['--secret_path', secretPath, 'start'], {
    cwd: PLAYIT_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tunnel: PlayitTunnel = {
    enabled: true,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  };
  agents.set(server.id, { child, tunnel });

  const handleOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    emitLog(server.id, `[playit] ${text}`);

    const claim = /https:\/\/playit\.gg\/(?:claim|mc)\/[A-Za-z0-9]+/.exec(text);
    if (claim) {
      tunnel.agentClaimUrl = claim[0];
      tunnel.status = 'pending';
      void persist(server.id, tunnel);
    }

    const address = /([a-z0-9-]+\.(?:craft|gl|joinmc|playit)\.[a-z.]+(?::\d+)?)/i.exec(text);
    if (address) {
      tunnel.publicAddress = address[1];
      tunnel.status = 'active';
      void persist(server.id, tunnel);
    }
  };

  child.stdout?.on('data', handleOutput);
  child.stderr?.on('data', handleOutput);

  child.on('exit', (code) => {
    const entry = agents.get(server.id);
    if (entry) {
      entry.tunnel.status = code === 0 ? 'disabled' : 'error';
      void persist(server.id, entry.tunnel);
    }
    agents.delete(server.id);
  });

  await persist(server.id, tunnel);
  return tunnel;
}

async function persist(serverId: string, tunnel: PlayitTunnel): Promise<void> {
  await patchServer(serverId, {
    playitTunnel: { ...tunnel, updatedAt: new Date().toISOString() },
  }).catch(() => undefined);
}

export async function stopTunnel(serverId: string): Promise<void> {
  const entry = agents.get(serverId);
  if (!entry) return;
  try {
    entry.child.kill('SIGTERM');
  } catch {
    /* already dead */
  }
  agents.delete(serverId);
  await patchServer(serverId, {
    playitTunnel: { enabled: false, status: 'disabled', updatedAt: new Date().toISOString() },
  }).catch(() => undefined);
}

export function isTunnelRunning(serverId: string): boolean {
  return agents.has(serverId);
}

export async function stopAllTunnels(): Promise<void> {
  for (const id of [...agents.keys()]) await stopTunnel(id);
}
