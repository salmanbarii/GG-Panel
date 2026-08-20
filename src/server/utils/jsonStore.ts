import path from 'node:path';
import fs from 'fs-extra';
import { DATA_DIR } from './paths.js';

/**
 * Flat-file persistence. Every collection is a JSON document inside `.data/`.
 * All writes are serialised per-file and atomic (tmp file + rename) so a crash
 * mid-write can never truncate users.json or servers.json.
 */

const writeQueues = new Map<string, Promise<unknown>>();

function resolveFile(filename: string): string {
  const name = filename.endsWith('.json') ? filename : `${filename}.json`;
  return path.join(DATA_DIR, name);
}

export async function readJSON<T>(filename: string, fallback: T): Promise<T> {
  const file = resolveFile(filename);
  try {
    const raw = await fs.readFile(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return fallback;
    if (err instanceof SyntaxError) {
      // Corrupt file: keep a copy for forensics, continue with the fallback.
      await fs.copy(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
      return fallback;
    }
    throw err;
  }
}

export async function writeJSON<T>(filename: string, data: T): Promise<T> {
  const file = resolveFile(filename);
  const previous = writeQueues.get(file) ?? Promise.resolve();

  const task = previous.catch(() => undefined).then(async () => {
    await fs.ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
    return data;
  });

  writeQueues.set(file, task);
  try {
    return await task;
  } finally {
    if (writeQueues.get(file) === task) writeQueues.delete(file);
  }
}

/** Read → mutate → write in a single queued operation (prevents lost updates). */
export async function updateJSON<T>(
  filename: string,
  fallback: T,
  mutator: (current: T) => T | Promise<T>,
): Promise<T> {
  const file = resolveFile(filename);
  const previous = writeQueues.get(file) ?? Promise.resolve();

  const task = previous.catch(() => undefined).then(async () => {
    const current = await readJSON<T>(filename, fallback);
    const next = await mutator(current);
    await fs.ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
    return next;
  });

  writeQueues.set(file, task);
  try {
    return await task;
  } finally {
    if (writeQueues.get(file) === task) writeQueues.delete(file);
  }
}

export async function ensureJSONFile<T>(filename: string, initial: T): Promise<void> {
  const file = resolveFile(filename);
  if (!(await fs.pathExists(file))) {
    await writeJSON(filename, initial);
  }
}

// ── collection names ───────────────────────────────────────────────────────
export const FILES = {
  users: 'users.json',
  servers: 'servers.json',
  settings: 'settings.json',
  nodes: 'nodes.json',
  wingsNodes: 'wings_nodes.json',
  sftpUsers: 'sftp_users.json',
  apiKeys: 'api_keys.json',
  notifications: 'notifications.json',
} as const;
