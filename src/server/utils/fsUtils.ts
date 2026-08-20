import fs from 'fs-extra';
import { open as openFile, statfs } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Recursively measure a directory. Uses `du` when available (much faster). */
export async function dirSizeBytes(target: string): Promise<number> {
  if (!(await fs.pathExists(target))) return 0;

  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFileAsync('du', ['-sb', target], { timeout: 15_000 });
      const bytes = Number.parseInt(stdout.trim().split(/\s+/)[0], 10);
      if (Number.isFinite(bytes)) return bytes;
    } catch {
      /* fall through to the JS walker */
    }
  }

  let total = 0;
  const stack: string[] = [target];
  while (stack.length) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += (await fs.stat(full)).size;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  }
  return total;
}

export async function dirSizeGb(target: string): Promise<number> {
  const bytes = await dirSizeBytes(target);
  return Number((bytes / 1024 / 1024 / 1024).toFixed(3));
}

export interface DiskUsage {
  totalGb: number;
  freeGb: number;
  usedGb: number;
}

/** Filesystem usage for the partition holding `target`. */
export async function diskUsage(target: string): Promise<DiskUsage> {
  try {
    const stat = await statfs(target);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    return {
      totalGb: Number((total / 1024 ** 3).toFixed(2)),
      freeGb: Number((free / 1024 ** 3).toFixed(2)),
      usedGb: Number(((total - free) / 1024 ** 3).toFixed(2)),
    };
  } catch {
    return { totalGb: 0, freeGb: 0, usedGb: 0 };
  }
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.properties', '.json', '.json5', '.yml', '.yaml', '.toml', '.cfg', '.conf', '.config',
  '.log', '.md', '.sh', '.bat', '.ini', '.xml', '.html', '.css', '.js', '.ts', '.mcmeta', '.snbt',
  '.csv', '.env', '.lang', '.tsv', '.gitignore', '.sk', '.py', '.lua',
]);

export function isTextFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return ['eula.txt', 'ops.json', 'whitelist.json', 'banned-players.json'].includes(
    path.basename(filename).toLowerCase(),
  );
}

/** Best-effort binary sniff so the editor refuses to mangle jars/images. */
export async function looksBinary(file: string): Promise<boolean> {
  try {
    const handle = await openFile(file, 'r');
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
      return buffer.subarray(0, bytesRead).includes(0);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function sanitizeFilename(name: string): string {
  return path
    .basename(String(name ?? ''))
    .replace(/[\u0000-\u001f<>:"|?*\\]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 200);
}
