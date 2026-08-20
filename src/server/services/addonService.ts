import fs from 'fs-extra';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { InstalledAddon, ModrinthProject } from '../../types/index.js';
import { serverDir } from '../utils/paths.js';
import { sanitizeFilename } from '../utils/fsUtils.js';

/**
 * Plugin/mod installation from Modrinth (and direct URLs, including SpigotMC
 * resource links). Files land in `plugins/` or `mods/` inside the server dir.
 */

const MODRINTH_API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'GG-Panel/1.0 (server-management-panel)';

export type AddonKind = 'plugin' | 'mod';

function addonDir(serverId: string, kind: AddonKind): string {
  return path.join(serverDir(serverId), kind === 'plugin' ? 'plugins' : 'mods');
}

interface ModrinthSearchResponse {
  hits: {
    project_id: string;
    slug: string;
    title: string;
    description: string;
    downloads: number;
    icon_url?: string | null;
    categories?: string[];
    versions?: string[];
    author?: string;
  }[];
  total_hits: number;
}

interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  files: { url: string; filename: string; primary: boolean; size: number }[];
}

export async function searchModrinth(options: {
  query: string;
  kind: AddonKind;
  gameVersion?: string;
  loader?: string;
  limit?: number;
  offset?: number;
}): Promise<{ hits: ModrinthProject[]; total: number }> {
  const facets: string[][] = [[`project_type:${options.kind === 'plugin' ? 'plugin' : 'mod'}`]];
  if (options.gameVersion) facets.push([`versions:${options.gameVersion}`]);
  if (options.loader) facets.push([`categories:${options.loader}`]);

  const params = new URLSearchParams({
    query: options.query ?? '',
    limit: String(Math.min(options.limit ?? 20, 100)),
    offset: String(options.offset ?? 0),
    index: 'relevance',
    facets: JSON.stringify(facets),
  });

  const res = await fetch(`${MODRINTH_API}/search?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Modrinth search failed (HTTP ${res.status})`), {
      statusCode: 502,
    });
  }

  const data = (await res.json()) as ModrinthSearchResponse;
  return { hits: data.hits, total: data.total_hits };
}

/** Extract a Modrinth slug from a full project URL or return the input as-is. */
export function parseModrinthSlug(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = /modrinth\.com\/(?:mod|plugin|datapack|resourcepack)\/([^/?#]+)/i.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  if (/^[a-z0-9\-_]+$/i.test(trimmed)) return trimmed;
  return null;
}

async function pickModrinthVersion(
  slug: string,
  options: { gameVersion?: string; loader?: string },
): Promise<ModrinthVersion> {
  const res = await fetch(`${MODRINTH_API}/project/${encodeURIComponent(slug)}/version`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Modrinth project "${slug}" not found`), { statusCode: 404 });
  }

  const versions = (await res.json()) as ModrinthVersion[];
  if (!versions.length) {
    throw Object.assign(new Error(`"${slug}" has no published files`), { statusCode: 404 });
  }

  const matchesLoader = (v: ModrinthVersion) =>
    !options.loader || v.loaders.some((l) => l.toLowerCase() === options.loader?.toLowerCase());
  const matchesGame = (v: ModrinthVersion) =>
    !options.gameVersion || v.game_versions.includes(options.gameVersion);

  return (
    versions.find((v) => matchesGame(v) && matchesLoader(v)) ??
    versions.find(matchesGame) ??
    versions.find(matchesLoader) ??
    versions[0]
  );
}

async function downloadFile(url: string, destination: string): Promise<number> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw Object.assign(new Error(`Download failed (HTTP ${res.status})`), { statusCode: 502 });
  }
  await fs.ensureDir(path.dirname(destination));
  const tmp = `${destination}.part`;
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    fs.createWriteStream(tmp),
  );
  await fs.move(tmp, destination, { overwrite: true });
  return (await fs.stat(destination)).size;
}

export interface InstallAddonResult {
  filename: string;
  size: number;
  source: string;
  version?: string;
  kind: AddonKind;
}

/**
 * Install by Modrinth slug/URL, or by a direct jar URL. SpigotMC resource pages
 * are converted to their download endpoint where possible.
 */
export async function installAddon(options: {
  serverId: string;
  kind: AddonKind;
  source: string;
  gameVersion?: string;
  loader?: string;
  filename?: string;
}): Promise<InstallAddonResult> {
  const { serverId, kind, source } = options;
  const targetDir = addonDir(serverId, kind);
  await fs.ensureDir(targetDir);

  const trimmed = source.trim();
  if (!trimmed) {
    throw Object.assign(new Error('A Modrinth slug, project URL or jar URL is required'), {
      statusCode: 400,
    });
  }

  // 1. Direct jar URL.
  if (/^https?:\/\//i.test(trimmed) && !/modrinth\.com/i.test(trimmed)) {
    const spigot = /spigotmc\.org\/resources\/[^/]*?\.(\d+)/i.exec(trimmed);
    const url = spigot
      ? `https://api.spiget.org/v2/resources/${spigot[1]}/download`
      : trimmed;

    let filename = options.filename ?? path.basename(new URL(url).pathname) ?? 'addon.jar';
    if (spigot) {
      const meta = await fetch(`https://api.spiget.org/v2/resources/${spigot[1]}`, {
        headers: { 'User-Agent': USER_AGENT },
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ name?: string }>) : null))
        .catch(() => null);
      const name = meta?.name?.replace(/[^a-z0-9\-_. ]/gi, '').trim();
      if (name) filename = `${name}.jar`;
    }
    if (!filename.toLowerCase().endsWith('.jar')) filename = `${filename}.jar`;

    const safe = sanitizeFilename(filename);
    const size = await downloadFile(url, path.join(targetDir, safe));
    return { filename: safe, size, source: url, kind };
  }

  // 2. Modrinth project.
  const slug = parseModrinthSlug(trimmed);
  if (!slug) {
    throw Object.assign(new Error(`Could not understand "${trimmed}"`), { statusCode: 400 });
  }

  const version = await pickModrinthVersion(slug, {
    gameVersion: options.gameVersion,
    loader: options.loader,
  });
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) {
    throw Object.assign(new Error(`"${slug}" has no downloadable file`), { statusCode: 404 });
  }

  const safe = sanitizeFilename(file.filename);
  const size = await downloadFile(file.url, path.join(targetDir, safe));
  return { filename: safe, size, source: file.url, version: version.version_number, kind };
}

export async function listInstalledAddons(
  serverId: string,
  kind: AddonKind,
): Promise<InstalledAddon[]> {
  const dir = addonDir(serverId, kind);
  if (!(await fs.pathExists(dir))) return [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: InstalledAddon[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.jar') && !lower.endsWith('.jar.disabled')) continue;
    const stats = await fs.stat(path.join(dir, entry.name));
    results.push({
      filename: entry.name,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      enabled: !lower.endsWith('.disabled'),
    });
  }
  return results.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function removeAddon(
  serverId: string,
  kind: AddonKind,
  filename: string,
): Promise<void> {
  const safe = sanitizeFilename(filename);
  const target = path.join(addonDir(serverId, kind), safe);
  if (!(await fs.pathExists(target))) {
    throw Object.assign(new Error('File not found'), { statusCode: 404 });
  }
  await fs.remove(target);
}

export async function toggleAddon(
  serverId: string,
  kind: AddonKind,
  filename: string,
): Promise<InstalledAddon> {
  const safe = sanitizeFilename(filename);
  const dir = addonDir(serverId, kind);
  const current = path.join(dir, safe);
  if (!(await fs.pathExists(current))) {
    throw Object.assign(new Error('File not found'), { statusCode: 404 });
  }

  const disabled = safe.toLowerCase().endsWith('.disabled');
  const next = disabled ? safe.replace(/\.disabled$/i, '') : `${safe}.disabled`;
  await fs.move(current, path.join(dir, next), { overwrite: true });

  const stats = await fs.stat(path.join(dir, next));
  return {
    filename: next,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    enabled: disabled,
  };
}

/** Loader facet for Modrinth searches, derived from the server software. */
export function loaderForServerType(serverType: string): string | undefined {
  switch (serverType) {
    case 'fabric':
      return 'fabric';
    case 'forge':
      return 'forge';
    case 'neoforge':
      return 'neoforge';
    case 'paper':
    case 'purpur':
    case 'spigot':
      return 'paper';
    case 'velocity':
      return 'velocity';
    case 'bungeecord':
    case 'waterfall':
      return 'bungeecord';
    default:
      return undefined;
  }
}
