import fs from 'fs-extra';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { JavaVersion, MinecraftServerType } from '../../types/index.js';
import { serverDir } from '../utils/paths.js';
import { emitInstall } from '../utils/panelEvents.js';

/**
 * Resolves and downloads the correct server jar for a software/version pair.
 * Every provider (vanilla, paper, purpur, fabric, forge, neoforge, spigot and
 * the proxies) is handled here so the runtime layer only deals with `server.jar`.
 */

const MOJANG_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
/** PaperMC "Fill" API (v2 was sunset in 2025). */
const PAPER_API = 'https://fill.papermc.io/v3/projects';
const PURPUR_API = 'https://api.purpurmc.org/v2/purpur';
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions';
const FORGE_PROMOTIONS =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_META =
  'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const BUNGEE_JAR =
  'https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar';
const SPIGOT_JAR = 'https://download.getbukkit.org/spigot';

const USER_AGENT = 'JTG-Panel/1.0 (+https://github.com/jtg-panel)';

export interface JarResolution {
  url: string;
  filename: string;
  /** Forge/NeoForge ship an installer that must be run once before first boot. */
  isInstaller?: boolean;
  build?: string;
  notes?: string;
}

interface MojangManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string; releaseTime: string }[];
}

interface MojangVersionDetail {
  downloads?: { server?: { url: string; sha1: string; size: number } };
  javaVersion?: { majorVersion: number };
}

/** Fill v3 groups versions by minor release: { "1.21": ["1.21.4", …] }. */
interface PaperProjectResponse {
  project: { id: string; name: string };
  versions: Record<string, string[]>;
}

interface PaperBuildResponse {
  id: number;
  channel?: string;
  downloads: Record<string, { name: string; url: string; size?: number }>;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status} ${res.statusText}): ${url}`);
  }
  return (await res.json()) as T;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  return res.text();
}

/** Flatten Fill's grouped version map, newest first. */
async function paperVersions(project: 'paper' | 'waterfall' | 'velocity'): Promise<string[]> {
  const data = await getJSON<PaperProjectResponse>(`${PAPER_API}/${project}`);
  return Object.values(data.versions).flat();
}

// ── version listings (used by the create-server wizard) ────────────────────
export async function listMinecraftVersions(includeSnapshots = false): Promise<
  { id: string; type: string; releaseTime: string }[]
> {
  const manifest = await getJSON<MojangManifest>(MOJANG_MANIFEST);
  return manifest.versions
    .filter((v) => includeSnapshots || v.type === 'release')
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}

export async function listVersionsFor(
  serverType: MinecraftServerType,
  includeSnapshots = false,
): Promise<string[]> {
  try {
    switch (serverType) {
      case 'paper':
      case 'waterfall':
      case 'velocity': {
        const versions = await paperVersions(serverType);
        return includeSnapshots
          ? versions
          : versions.filter((v) => !/(-rc|-pre|snapshot)/i.test(v));
      }
      case 'purpur': {
        const data = await getJSON<{ versions: string[] }>(PURPUR_API);
        return [...data.versions].reverse();
      }
      case 'fabric': {
        const data = await getJSON<{ version: string; stable: boolean }[]>(`${FABRIC_META}/game`);
        return data.filter((v) => includeSnapshots || v.stable).map((v) => v.version);
      }
      case 'forge': {
        const promos = await getJSON<{ promos: Record<string, string> }>(FORGE_PROMOTIONS);
        const versions = new Set<string>();
        for (const key of Object.keys(promos.promos)) versions.add(key.split('-')[0]);
        return [...versions].reverse();
      }
      case 'neoforge': {
        const xml = await getText(NEOFORGE_META);
        const builds = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
        // 21.1.95 → Minecraft 1.21.1
        const games = new Set<string>();
        for (const build of builds) {
          const match = /^(\d+)\.(\d+)\./.exec(build);
          if (match) games.add(`1.${match[1]}.${match[2]}`);
        }
        return [...games].reverse();
      }
      case 'bungeecord':
        return ['latest'];
      default: {
        const versions = await listMinecraftVersions(includeSnapshots);
        return versions.map((v) => v.id);
      }
    }
  } catch {
    // Network hiccup or upstream outage — fall back to the vanilla manifest.
    const versions = await listMinecraftVersions(includeSnapshots).catch(() => []);
    return versions.map((v) => v.id);
  }
}

// ── java version mapping ───────────────────────────────────────────────────
/** Minimum Java major version required by a given Minecraft version. */
export function recommendedJavaVersion(version: string): Exclude<JavaVersion, 'auto'> {
  const match = /^1\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) return '21';
  const minor = Number.parseInt(match[1], 10);
  if (minor >= 20) {
    const patch = Number.parseInt(match[2] ?? '0', 10);
    if (minor === 20 && patch < 5) return '17';
    return '21';
  }
  if (minor >= 18) return '17';
  if (minor === 17) return '16';
  if (minor >= 12) return '11';
  return '8';
}

export async function resolveJavaVersion(
  requested: JavaVersion | undefined,
  minecraftVersion: string,
): Promise<Exclude<JavaVersion, 'auto'>> {
  if (requested && requested !== 'auto') return requested;
  try {
    const manifest = await getJSON<MojangManifest>(MOJANG_MANIFEST);
    const entry = manifest.versions.find((v) => v.id === minecraftVersion);
    if (entry) {
      const detail = await getJSON<MojangVersionDetail>(entry.url);
      const major = detail.javaVersion?.majorVersion;
      if (major) {
        if (major >= 21) return '21';
        if (major >= 17) return '17';
        if (major >= 16) return '16';
        if (major >= 11) return '11';
        return '8';
      }
    }
  } catch {
    /* offline — fall back to the static table */
  }
  return recommendedJavaVersion(minecraftVersion);
}

// ── jar resolution ─────────────────────────────────────────────────────────
async function resolveVanilla(version: string): Promise<JarResolution> {
  const manifest = await getJSON<MojangManifest>(MOJANG_MANIFEST);
  const wanted =
    version === 'latest' || !version
      ? manifest.latest.release
      : version;
  const entry = manifest.versions.find((v) => v.id === wanted);
  if (!entry) throw new Error(`Unknown Minecraft version: ${version}`);
  const detail = await getJSON<MojangVersionDetail>(entry.url);
  const url = detail.downloads?.server?.url;
  if (!url) throw new Error(`Version ${wanted} has no downloadable server jar`);
  return { url, filename: 'server.jar' };
}

async function resolvePaperFamily(
  project: 'paper' | 'waterfall' | 'velocity',
  version: string,
): Promise<JarResolution> {
  const versions = await paperVersions(project);
  const target = version && versions.includes(version) ? version : versions[0];
  if (!target) throw new Error(`No ${project} versions are published`);

  const build = await getJSON<PaperBuildResponse>(
    `${PAPER_API}/${project}/versions/${target}/builds/latest`,
  );

  // Fill exposes download keys such as "server:default".
  const download =
    build.downloads['server:default'] ??
    build.downloads['application'] ??
    Object.values(build.downloads)[0];

  if (!download?.url) throw new Error(`No downloadable ${project} build for ${target}`);

  return { url: download.url, filename: 'server.jar', build: String(build.id) };
}

async function resolvePurpur(version: string): Promise<JarResolution> {
  const info = await getJSON<{ versions: string[] }>(PURPUR_API);
  const target =
    version && info.versions.includes(version) ? version : info.versions[info.versions.length - 1];
  const latest = await getJSON<{ builds: { latest: string } }>(`${PURPUR_API}/${target}`);
  return {
    url: `${PURPUR_API}/${target}/${latest.builds.latest}/download`,
    filename: 'server.jar',
    build: latest.builds.latest,
  };
}

async function resolveFabric(version: string): Promise<JarResolution> {
  const [loaders, installers] = await Promise.all([
    getJSON<{ loader: { version: string; stable: boolean } }[]>(`${FABRIC_META}/loader/${version}`),
    getJSON<{ version: string; stable: boolean }[]>(`${FABRIC_META}/installer`),
  ]);
  const loader = loaders.find((l) => l.loader.stable) ?? loaders[0];
  const installer = installers.find((i) => i.stable) ?? installers[0];
  if (!loader || !installer) throw new Error(`Fabric is unavailable for ${version}`);
  return {
    url: `${FABRIC_META}/loader/${version}/${loader.loader.version}/${installer.version}/server/jar`,
    filename: 'server.jar',
    build: loader.loader.version,
  };
}

async function resolveForge(version: string): Promise<JarResolution> {
  const promos = await getJSON<{ promos: Record<string, string> }>(FORGE_PROMOTIONS);
  const build = promos.promos[`${version}-recommended`] ?? promos.promos[`${version}-latest`];
  if (!build) throw new Error(`No Forge build published for ${version}`);
  const full = `${version}-${build}`;
  return {
    url: `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`,
    filename: 'forge-installer.jar',
    isInstaller: true,
    build,
    notes: 'Forge installer will run on first start to generate the server files.',
  };
}

async function resolveNeoForge(version: string): Promise<JarResolution> {
  const xml = await getText(NEOFORGE_META);
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  // 1.21.1 → neoforge 21.1.x
  const parts = version.split('.');
  const prefix = `${parts[1] ?? ''}.${parts[2] ?? '0'}`;
  const candidates = all.filter((v) => v.startsWith(prefix));
  const build = (candidates.length ? candidates : all)[
    (candidates.length ? candidates : all).length - 1
  ];
  if (!build) throw new Error(`No NeoForge build found for ${version}`);
  return {
    url: `${NEOFORGE_MAVEN}/${build}/neoforge-${build}-installer.jar`,
    filename: 'forge-installer.jar',
    isInstaller: true,
    build,
    notes: 'NeoForge installer will run on first start to generate the server files.',
  };
}

async function resolveSpigot(version: string): Promise<JarResolution> {
  // Spigot has no official CDN; getbukkit mirrors release builds. If the mirror
  // is missing the version we fall back to Paper (drop-in Spigot compatible).
  const url = `${SPIGOT_JAR}/spigot-${version}.jar`;
  try {
    const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    if (head.ok) return { url, filename: 'server.jar' };
  } catch {
    /* fall through */
  }
  const paper = await resolvePaperFamily('paper', version);
  return { ...paper, notes: 'Spigot jar unavailable upstream — installed Paper (Spigot compatible).' };
}

export async function resolveJarUrl(
  serverType: MinecraftServerType,
  version: string,
): Promise<JarResolution> {
  switch (serverType) {
    case 'paper':
      return resolvePaperFamily('paper', version);
    case 'waterfall':
      return resolvePaperFamily('waterfall', version);
    case 'velocity':
      return resolvePaperFamily('velocity', version);
    case 'purpur':
      return resolvePurpur(version);
    case 'fabric':
      return resolveFabric(version);
    case 'forge':
      return resolveForge(version);
    case 'neoforge':
      return resolveNeoForge(version);
    case 'spigot':
      return resolveSpigot(version);
    case 'bungeecord':
      return { url: BUNGEE_JAR, filename: 'server.jar' };
    case 'vanilla':
    default:
      return resolveVanilla(version);
  }
}

// ── download ───────────────────────────────────────────────────────────────
async function downloadTo(url: string, destination: string, onProgress?: (pct: number) => void) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  }

  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  let lastReported = 0;

  await fs.ensureDir(path.dirname(destination));
  const tmp = `${destination}.download`;
  const nodeStream = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);

  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (!total || !onProgress) return;
    const pct = Math.floor((received / total) * 100);
    if (pct >= lastReported + 10) {
      lastReported = pct;
      onProgress(pct);
    }
  });

  await pipeline(nodeStream, fs.createWriteStream(tmp));
  await fs.move(tmp, destination, { overwrite: true });
  return { bytes: received };
}

export interface DownloadJarOptions {
  serverId: string;
  serverType: MinecraftServerType;
  version: string;
  /** Emit progress into the install stream for this server. */
  announce?: boolean;
}

export interface DownloadJarResult extends JarResolution {
  jarPath: string;
  bytes: number;
}

export async function downloadServerJar(options: DownloadJarOptions): Promise<DownloadJarResult> {
  const { serverId, serverType, version, announce = true } = options;
  const dir = serverDir(serverId);
  await fs.ensureDir(dir);

  const say = (message: string) => {
    if (announce) emitInstall(serverId, message);
  };

  say(`Resolving ${serverType} ${version}…`);
  const resolution = await resolveJarUrl(serverType, version);
  if (resolution.notes) say(resolution.notes);
  say(`Downloading ${resolution.url}`);

  const jarPath = path.join(dir, resolution.filename);
  const { bytes } = await downloadTo(resolution.url, jarPath, (pct) => say(`Download ${pct}%`));

  say(`Downloaded ${(bytes / 1024 / 1024).toFixed(1)} MB → ${resolution.filename}`);
  return { ...resolution, jarPath, bytes };
}

// ── server.properties / eula bootstrap ─────────────────────────────────────
export function defaultServerProperties(options: {
  name: string;
  port: number;
  motd?: string;
}): string {
  const lines: Record<string, string | number> = {
    'server-port': options.port,
    'query.port': options.port,
    'rcon.port': options.port + 10,
    'enable-rcon': 'true',
    'rcon.password': 'jtgpanel',
    motd: options.motd ?? `${options.name} — powered by JTG Panel`,
    'max-players': 20,
    'online-mode': 'true',
    'enable-command-block': 'false',
    difficulty: 'easy',
    gamemode: 'survival',
    pvp: 'true',
    'spawn-protection': 16,
    'view-distance': 10,
    'simulation-distance': 10,
    'level-name': 'world',
    'level-seed': '',
    'level-type': 'minecraft:normal',
    'allow-nether': 'true',
    'allow-flight': 'false',
    hardcore: 'false',
    'white-list': 'false',
    'spawn-animals': 'true',
    'spawn-monsters': 'true',
    'spawn-npcs': 'true',
  };

  return [
    '#Minecraft server properties',
    `#Generated by JTG Panel on ${new Date().toISOString()}`,
    ...Object.entries(lines).map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n');
}

export async function writeInitialConfig(options: {
  serverId: string;
  name: string;
  port: number;
  serverType: MinecraftServerType;
}): Promise<void> {
  const dir = serverDir(options.serverId);
  await fs.ensureDir(dir);

  await fs.writeFile(
    path.join(dir, 'eula.txt'),
    `#Accepted through the JTG Panel installer\neula=true\n`,
    'utf8',
  );

  const isProxy = ['bungeecord', 'waterfall', 'velocity'].includes(options.serverType);
  if (isProxy) {
    if (options.serverType === 'velocity') {
      const velocityToml = [
        'config-version = "2.6"',
        `bind = "0.0.0.0:${options.port}"`,
        `motd = "<yellow>${options.name}</yellow>"`,
        'show-max-players = 100',
        'online-mode = true',
        'player-info-forwarding-mode = "legacy"',
        '',
        '[servers]',
        '',
        '[advanced]',
        '',
        '[query]',
        'enabled = false',
        '',
      ].join('\n');
      await fs.writeFile(path.join(dir, 'velocity.toml'), velocityToml, 'utf8');
    } else {
      const bungeeConfig = [
        'listeners:',
        '- query_port: ' + options.port,
        '  motd: "&e' + options.name + '"',
        '  host: 0.0.0.0:' + options.port,
        '  max_players: 100',
        'servers: {}',
        'ip_forward: true',
        '',
      ].join('\n');
      await fs.writeFile(path.join(dir, 'config.yml'), bungeeConfig, 'utf8');
    }
    return;
  }

  const propsPath = path.join(dir, 'server.properties');
  if (!(await fs.pathExists(propsPath))) {
    await fs.writeFile(
      propsPath,
      defaultServerProperties({ name: options.name, port: options.port }),
      'utf8',
    );
  }
}

/** Rewrite the `server-port` (and friends) inside an existing server.properties. */
export async function applyPortToProperties(serverId: string, port: number): Promise<void> {
  const propsPath = path.join(serverDir(serverId), 'server.properties');
  if (!(await fs.pathExists(propsPath))) return;
  const raw = await fs.readFile(propsPath, 'utf8');
  const updated = raw
    .split('\n')
    .map((line) => {
      if (line.startsWith('server-port=')) return `server-port=${port}`;
      if (line.startsWith('query.port=')) return `query.port=${port}`;
      if (line.startsWith('rcon.port=')) return `rcon.port=${port + 10}`;
      return line;
    })
    .join('\n');
  await fs.writeFile(propsPath, updated, 'utf8');
}
