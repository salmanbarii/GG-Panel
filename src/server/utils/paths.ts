import path from 'node:path';
import fs from 'fs-extra';
import { fileURLToPath } from 'node:url';

/**
 * Resolves the panel root directory. In dev this is the repo root (cwd);
 * in the esbuild bundle __dirname is dist/server so we walk up two levels.
 */
function resolveRoot(): string {
  const envRoot = process.env.PANEL_ROOT;
  if (envRoot) return path.resolve(envRoot);

  // The bundle lives at <root>/dist/server/server.js
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    if (here.includes(`${path.sep}dist${path.sep}server`)) {
      return path.resolve(here, '..', '..');
    }
  } catch {
    /* import.meta not available (should not happen) */
  }
  return process.cwd();
}

export const ROOT_DIR = resolveRoot();
export const DATA_DIR = path.join(ROOT_DIR, '.data');
export const SERVERS_DIR = path.join(DATA_DIR, 'servers');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const SSH_DIR = path.join(DATA_DIR, 'ssh');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const JARS_CACHE_DIR = path.join(DATA_DIR, 'jars');
export const CLIENT_DIST_DIR = path.join(ROOT_DIR, 'dist', 'client');

/** Absolute path of a server's data directory (the Docker /data mount). */
export function serverDir(serverId: string): string {
  return path.join(SERVERS_DIR, serverId);
}

/** Absolute path of a server's backup directory. */
export function serverBackupDir(serverId: string): string {
  return path.join(BACKUPS_DIR, serverId);
}

/**
 * Safely resolve a user supplied relative path inside a server directory.
 * Prevents `../` traversal out of the jail. Throws on escape attempts.
 */
export function safeServerPath(serverId: string, relativePath = '/'): string {
  const base = serverDir(serverId);
  const cleaned = String(relativePath || '/')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const target = path.resolve(base, cleaned);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Path escapes server directory'), { statusCode: 400 });
  }
  return target;
}

/** Same as safeServerPath but for any jail root (used by the SFTP server). */
export function safeJoin(jailRoot: string, relativePath: string): string {
  const cleaned = String(relativePath || '/')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const target = path.resolve(jailRoot, cleaned);
  const rel = path.relative(jailRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Path escapes jail'), { statusCode: 400 });
  }
  return target;
}

export async function ensureDataDirs(): Promise<void> {
  await Promise.all(
    [DATA_DIR, SERVERS_DIR, BACKUPS_DIR, SSH_DIR, TMP_DIR, LOGS_DIR, JARS_CACHE_DIR].map((dir) =>
      fs.ensureDir(dir),
    ),
  );
}
