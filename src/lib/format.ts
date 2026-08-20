import type { GameServerView, MinecraftServerType, ServerStatus } from '@/types';

/** Formatting + presentation helpers shared across the UI. */

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export const STATUS_STYLES: Record<ServerStatus, { label: string; dot: string; text: string; bg: string }> = {
  online: {
    label: 'Online',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-zinc-500',
    text: 'text-zinc-400',
    bg: 'bg-zinc-500/10 border-zinc-500/30',
  },
  starting: {
    label: 'Starting',
    dot: 'bg-amber-400 animate-pulse',
    text: 'text-amber-300',
    bg: 'bg-amber-500/10 border-amber-500/30',
  },
  stopping: {
    label: 'Stopping',
    dot: 'bg-orange-400 animate-pulse',
    text: 'text-orange-300',
    bg: 'bg-orange-500/10 border-orange-500/30',
  },
  installing: {
    label: 'Installing',
    dot: 'bg-sky-400 animate-pulse',
    text: 'text-sky-300',
    bg: 'bg-sky-500/10 border-sky-500/30',
  },
  error: {
    label: 'Error',
    dot: 'bg-red-500',
    text: 'text-red-300',
    bg: 'bg-red-500/10 border-red-500/30',
  },
};

export const SERVER_SOFTWARE: {
  value: MinecraftServerType;
  label: string;
  description: string;
  kind: 'server' | 'proxy';
}[] = [
  { value: 'vanilla', label: 'Vanilla', description: "Mojang's official server, no plugins", kind: 'server' },
  { value: 'paper', label: 'Paper', description: 'High performance Spigot fork — recommended', kind: 'server' },
  { value: 'purpur', label: 'Purpur', description: 'Paper fork with extra gameplay settings', kind: 'server' },
  { value: 'spigot', label: 'Spigot', description: 'Classic Bukkit plugin server', kind: 'server' },
  { value: 'fabric', label: 'Fabric', description: 'Lightweight modding toolchain', kind: 'server' },
  { value: 'forge', label: 'Forge', description: 'Long-standing mod loader, big modpacks', kind: 'server' },
  { value: 'neoforge', label: 'NeoForge', description: 'Modern Forge continuation', kind: 'server' },
  { value: 'velocity', label: 'Velocity', description: 'Modern proxy for server networks', kind: 'proxy' },
  { value: 'bungeecord', label: 'BungeeCord', description: 'Classic network proxy', kind: 'proxy' },
  { value: 'waterfall', label: 'Waterfall', description: 'BungeeCord fork (legacy)', kind: 'proxy' },
];

export function softwareLabel(type: MinecraftServerType): string {
  return SERVER_SOFTWARE.find((s) => s.value === type)?.label ?? type;
}

export function serverAddress(server: GameServerView): string {
  if (server.playitTunnel?.publicAddress) return server.playitTunnel.publicAddress;
  if (server.ipAlias) return `${server.ipAlias}:${server.port}`;
  if (server.connectAddress && !server.connectAddress.startsWith(':')) return server.connectAddress;
  return `${window.location.hostname}:${server.port}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Strip ANSI escape codes and Minecraft § colour codes for plain text output. */
export function stripAnsi(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/§[0-9a-fk-or]/gi, '');
}

export function fileIconName(filename: string, isDirectory: boolean): string {
  if (isDirectory) return 'folder';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['jar', 'zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return 'archive';
  if (['json', 'yml', 'yaml', 'toml', 'properties', 'cfg', 'conf', 'ini'].includes(ext)) return 'settings';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)) return 'image';
  if (['log', 'txt', 'md'].includes(ext)) return 'text';
  if (['sh', 'bat', 'js', 'ts', 'py', 'lua'].includes(ext)) return 'code';
  if (['dat', 'mca', 'nbt', 'lock'].includes(ext)) return 'binary';
  return 'file';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Percentage with a hard 0–100 clamp, safe against divide-by-zero. */
export function percent(value: number, total: number): number {
  if (!total) return 0;
  return clamp((value / total) * 100, 0, 100);
}
