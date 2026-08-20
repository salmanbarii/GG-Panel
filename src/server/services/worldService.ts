import fs from 'fs-extra';
import path from 'node:path';
import nbt from 'prismarine-nbt';
import extract from 'extract-zip';
import type { WorldInfo } from '../../types/index.js';
import { serverDir } from '../utils/paths.js';
import { dirSizeBytes } from '../utils/fsUtils.js';

/**
 * World tooling: parse level.dat (gzipped NBT) for metadata and import
 * uploaded world archives.
 */

type NbtValue = {
  value?: unknown;
  type?: string;
};

function unwrap(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  const candidate = node as NbtValue;
  if (!('value' in candidate)) return node;

  const value = candidate.value;
  if (candidate.type === 'compound' && value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = unwrap(child);
    }
    return out;
  }
  if (candidate.type === 'list' && value && typeof value === 'object') {
    const listValue = (value as { value?: unknown }).value;
    if (Array.isArray(listValue)) return listValue.map((item) => unwrap(item));
    return [];
  }
  if (Array.isArray(value) && value.length === 2 && candidate.type === 'long') {
    // prismarine-nbt encodes longs as [high, low]
    const [high, low] = value as [number, number];
    return (BigInt(high | 0) << 32n) | BigInt(low >>> 0);
  }
  return value;
}

/**
 * A directory counts as a world when it has level.dat, or (before the first save)
 * the markers the server creates immediately: region/, session.lock, uid.dat.
 */
async function isWorldDir(candidate: string): Promise<boolean> {
  const markers = ['level.dat', 'region', 'session.lock', 'uid.dat'];
  for (const marker of markers) {
    if (await fs.pathExists(path.join(candidate, marker))) return true;
  }
  return false;
}

async function findWorldDir(serverId: string): Promise<string | null> {
  const base = serverDir(serverId);

  // Honour level-name from server.properties first.
  const propsPath = path.join(base, 'server.properties');
  if (await fs.pathExists(propsPath)) {
    const raw = await fs.readFile(propsPath, 'utf8');
    const match = /^level-name=(.*)$/m.exec(raw);
    const levelName = match?.[1]?.trim();
    if (levelName) {
      const candidate = path.join(base, levelName);
      if (await isWorldDir(candidate)) return candidate;
    }
  }

  const fallbacks = ['world', 'World', 'world_nether', 'world_the_end'];
  for (const name of fallbacks) {
    const candidate = path.join(base, name);
    if (await isWorldDir(candidate)) return candidate;
  }

  // Last resort: scan one level deep for any world-looking directory.
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(base, entry.name);
    if (await isWorldDir(candidate)) return candidate;
  }
  return null;
}

export async function analyzeWorld(serverId: string): Promise<WorldInfo> {
  const worldDir = await findWorldDir(serverId);
  if (!worldDir) {
    return { name: 'world', sizeBytes: 0, dimensions: [], exists: false };
  }

  const info: WorldInfo = {
    name: path.basename(worldDir),
    sizeBytes: await dirSizeBytes(worldDir),
    dimensions: [],
    exists: true,
  };

  // Dimensions present on disk.
  const dims: string[] = [];
  if (await fs.pathExists(path.join(worldDir, 'region'))) dims.push('overworld');
  const base = serverDir(serverId);
  if (
    (await fs.pathExists(path.join(worldDir, 'DIM-1'))) ||
    (await fs.pathExists(path.join(base, `${info.name}_nether`)))
  ) {
    dims.push('the_nether');
  }
  if (
    (await fs.pathExists(path.join(worldDir, 'DIM1'))) ||
    (await fs.pathExists(path.join(base, `${info.name}_the_end`)))
  ) {
    dims.push('the_end');
  }
  info.dimensions = dims;

  const levelDat = path.join(worldDir, 'level.dat');
  try {
    const buffer = await fs.readFile(levelDat);
    const { parsed } = await nbt.parse(buffer);
    const root = unwrap(parsed) as Record<string, unknown>;
    const data = (root.Data ?? root) as Record<string, unknown>;

    info.levelName = typeof data.LevelName === 'string' ? data.LevelName : info.name;

    const worldGen = data.WorldGenSettings as Record<string, unknown> | undefined;
    const seed = worldGen?.seed ?? data.RandomSeed;
    if (seed !== undefined && seed !== null) info.seed = String(seed);

    const versionInfo = data.Version as Record<string, unknown> | undefined;
    if (versionInfo?.Name) info.version = String(versionInfo.Name);

    if (typeof data.GameType === 'number') info.gameType = data.GameType;
    if (typeof data.Difficulty === 'number') info.difficulty = data.Difficulty;
    info.hardcore = Boolean(data.hardcore);
    info.allowCommands = Boolean(data.allowCommands);

    if (typeof data.SpawnX === 'number') {
      info.spawn = {
        x: data.SpawnX,
        y: typeof data.SpawnY === 'number' ? data.SpawnY : 0,
        z: typeof data.SpawnZ === 'number' ? data.SpawnZ : 0,
      };
    }

    const lastPlayed = data.LastPlayed;
    if (lastPlayed !== undefined && lastPlayed !== null) {
      const ms = Number(lastPlayed);
      if (Number.isFinite(ms) && ms > 0) info.lastPlayed = new Date(ms).toISOString();
    }
  } catch {
    // level.dat may be from an unsupported edition — the on-disk info still applies.
  }

  return info;
}

/**
 * Import a world archive. Accepts zips that contain the world folder at the root
 * or nested one level deep, and installs it as the active `level-name` world.
 */
export async function importWorld(options: {
  serverId: string;
  zipPath: string;
  targetName?: string;
  keepBackup?: boolean;
}): Promise<WorldInfo> {
  const { serverId, zipPath } = options;
  const base = serverDir(serverId);
  const stagingDir = path.join(base, `.world-import-${Date.now()}`);

  try {
    await fs.ensureDir(stagingDir);
    await extract(zipPath, { dir: stagingDir });

    // Locate the directory that actually holds level.dat.
    let sourceDir: string | null = null;
    if (await fs.pathExists(path.join(stagingDir, 'level.dat'))) {
      sourceDir = stagingDir;
    } else {
      const entries = await fs.readdir(stagingDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(stagingDir, entry.name);
        if (await fs.pathExists(path.join(candidate, 'level.dat'))) {
          sourceDir = candidate;
          break;
        }
      }
    }

    if (!sourceDir) {
      throw Object.assign(
        new Error('The archive does not contain a level.dat — is it a Minecraft world?'),
        { statusCode: 400 },
      );
    }

    const targetName = options.targetName?.trim() || 'world';
    const targetDir = path.join(base, path.basename(targetName));

    if (await fs.pathExists(targetDir)) {
      if (options.keepBackup !== false) {
        await fs.move(targetDir, `${targetDir}.replaced-${Date.now()}`, { overwrite: true });
      } else {
        await fs.remove(targetDir);
      }
    }

    await fs.move(sourceDir, targetDir, { overwrite: true });

    // Point server.properties at the imported world.
    const propsPath = path.join(base, 'server.properties');
    if (await fs.pathExists(propsPath)) {
      const raw = await fs.readFile(propsPath, 'utf8');
      const updated = raw.includes('level-name=')
        ? raw.replace(/^level-name=.*$/m, `level-name=${path.basename(targetDir)}`)
        : `${raw.trimEnd()}\nlevel-name=${path.basename(targetDir)}\n`;
      await fs.writeFile(propsPath, updated, 'utf8');
    }

    return analyzeWorld(serverId);
  } finally {
    await fs.remove(stagingDir).catch(() => undefined);
  }
}
