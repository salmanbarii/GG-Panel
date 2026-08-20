import fs from 'fs-extra';
import path from 'node:path';
import archiver from 'archiver';
import extract from 'extract-zip';
import type { BackupEntry } from '../../types/index.js';
import { TMP_DIR, serverBackupDir, serverDir } from '../utils/paths.js';
import { sanitizeFilename } from '../utils/fsUtils.js';

/** Zip based backups stored in `.data/backups/<serverId>/`. */

const EXCLUDED_FROM_BACKUP = new Set(['cache', 'crash-reports', 'libraries']);

export async function listBackups(serverId: string): Promise<BackupEntry[]> {
  const dir = serverBackupDir(serverId);
  if (!(await fs.pathExists(dir))) return [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const backups: BackupEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.zip')) continue;
    const stats = await fs.stat(path.join(dir, entry.name));
    backups.push({
      filename: entry.name,
      size: stats.size,
      createdAt: stats.mtime.toISOString(),
    });
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function backupFilePath(serverId: string, filename: string): string {
  const safe = sanitizeFilename(filename);
  if (!safe.toLowerCase().endsWith('.zip')) {
    throw Object.assign(new Error('Only .zip backups are supported'), { statusCode: 400 });
  }
  return path.join(serverBackupDir(serverId), safe);
}

export interface CreateBackupOptions {
  serverId: string;
  serverName: string;
  /** Skip caches/libraries to keep archives small. */
  lean?: boolean;
  onProgress?: (bytes: number, entries: number) => void;
}

export async function createBackup(options: CreateBackupOptions): Promise<BackupEntry> {
  const source = serverDir(options.serverId);
  if (!(await fs.pathExists(source))) {
    throw Object.assign(new Error('Server directory does not exist'), { statusCode: 404 });
  }

  const dir = serverBackupDir(options.serverId);
  await fs.ensureDir(dir);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug =
    options.serverName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'server';
  const filename = `${slug}-${stamp}.zip`;
  const target = path.join(dir, filename);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(target);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
    if (options.onProgress) {
      archive.on('progress', (data) =>
        options.onProgress?.(data.fs.processedBytes, data.entries.processed),
      );
    }

    archive.pipe(output);
    archive.glob('**/*', {
      cwd: source,
      dot: true,
      ignore: options.lean
        ? [...EXCLUDED_FROM_BACKUP].flatMap((d) => [`${d}/**`, d])
        : [],
    });
    void archive.finalize();
  });

  const stats = await fs.stat(target);
  return { filename, size: stats.size, createdAt: stats.mtime.toISOString() };
}

export async function deleteBackup(serverId: string, filename: string): Promise<void> {
  const target = backupFilePath(serverId, filename);
  if (!(await fs.pathExists(target))) {
    throw Object.assign(new Error('Backup not found'), { statusCode: 404 });
  }
  await fs.remove(target);
}

/**
 * Restore a backup over the live server directory. Extraction happens in a
 * staging directory outside the server folder, and the live directory is only
 * swapped once the archive has been unpacked successfully.
 */
export async function restoreBackup(serverId: string, filename: string): Promise<void> {
  const archivePath = backupFilePath(serverId, filename);
  if (!(await fs.pathExists(archivePath))) {
    throw Object.assign(new Error('Backup not found'), { statusCode: 404 });
  }

  const target = serverDir(serverId);
  const staging = path.join(TMP_DIR, `restore-${serverId}-${Date.now()}`);
  const previous = path.join(TMP_DIR, `pre-restore-${serverId}-${Date.now()}`);

  await fs.ensureDir(staging);
  let swapped = false;

  try {
    await extract(archivePath, { dir: staging });

    if (await fs.pathExists(target)) {
      await fs.move(target, previous, { overwrite: true });
      swapped = true;
    }
    await fs.move(staging, target, { overwrite: true });
    await fs.remove(previous).catch(() => undefined);
  } catch (err) {
    // Roll the live directory back if the swap already happened.
    if (swapped && (await fs.pathExists(previous))) {
      await fs.remove(target).catch(() => undefined);
      await fs.move(previous, target, { overwrite: true }).catch(() => undefined);
    }
    throw err;
  } finally {
    await fs.remove(staging).catch(() => undefined);
  }
}
