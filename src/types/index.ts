/**
 * Shared types between the React frontend and the Express backend.
 * Nothing in here may import runtime-only modules — it is consumed by both bundles.
 */

// ── users ──────────────────────────────────────────────────────────────────
export type UserRole = 'user' | 'admin' | 'owner';

export interface User {
  id: string;
  username: string;
  password: string; // bcrypt hash — never leaves the backend
  email?: string;
  role: UserRole;
  avatar?: string; // base64 data-url or remote url
  googleId?: string;
  createdAt: string;
}

export type PublicUser = Omit<User, 'password'>;

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

// ── servers ────────────────────────────────────────────────────────────────
export type ServerKind = 'minecraft' | 'generic';

export type MinecraftServerType =
  | 'vanilla'
  | 'paper'
  | 'purpur'
  | 'fabric'
  | 'forge'
  | 'neoforge'
  | 'spigot'
  | 'bungeecord'
  | 'waterfall'
  | 'velocity';

export type JavaVersion = '8' | '11' | '16' | '17' | '21' | 'auto';

export type RuntimeType = 'docker' | 'local' | 'wings';

export type ServerStatus = 'online' | 'offline' | 'starting' | 'stopping' | 'installing' | 'error';

export type SubUserPermission =
  | 'console'
  | 'files'
  | 'settings'
  | 'backups'
  | 'plugins'
  | 'players'
  | 'world'
  | 'sftp'
  | 'power';

export interface SubUser {
  userId: string;
  username: string;
  permissions: SubUserPermission[];
}

export interface GameServer {
  id: string;
  name: string;
  type: ServerKind;
  serverType: MinecraftServerType;
  version: string;
  javaVersion: JavaVersion;
  ram: number; // GB
  cpu: number; // percent of one core (100 = 1 core)
  port: number;
  owner: string; // user id
  runtimeType: RuntimeType;
  nodeId: string; // 'local' | node uuid
  containerId?: string; // docker container id, host pid, or wings uuid
  status: ServerStatus;
  suspended: boolean;
  ipAlias?: string;
  iconUrl?: string;
  subUsers?: SubUser[];
  installOutput?: string;
  playitTunnel?: PlayitTunnel;
  createdAt: string;
}

/** Server shape returned to the frontend (status resolved live from the runtime). */
export interface GameServerView extends GameServer {
  isRunning: boolean;
  ownerUsername?: string;
  connectAddress: string;
}

export interface CreateServerRequest {
  name: string;
  type?: ServerKind;
  version: string;
  ram: number;
  cpu: number;
  port: number;
  runtimeType?: RuntimeType;
  nodeId?: string;
  serverType?: MinecraftServerType;
  javaVersion?: JavaVersion;
  iconUrl?: string;
}

export interface ServerStats {
  cpu: number; // percent
  ram: number; // MB in use
  ramLimit: number; // MB allocated
  disk: number; // GB used
  uptime: number; // seconds
  isRunning: boolean;
  players?: PlayerInfo[];
  maxPlayers?: number;
}

export interface PlayerInfo {
  name: string;
  online: boolean;
  joinedAt?: string;
}

// ── files ──────────────────────────────────────────────────────────────────
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  mode?: string;
  isSymlink?: boolean;
}

export interface FileListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

// ── backups ────────────────────────────────────────────────────────────────
export interface BackupEntry {
  filename: string;
  size: number;
  createdAt: string;
}

// ── world ──────────────────────────────────────────────────────────────────
export interface WorldInfo {
  name: string;
  seed?: string;
  levelName?: string;
  version?: string;
  gameType?: number;
  difficulty?: number;
  hardcore?: boolean;
  allowCommands?: boolean;
  spawn?: { x: number; y: number; z: number };
  lastPlayed?: string;
  sizeBytes: number;
  dimensions: string[];
  exists: boolean;
}

// ── plugins / mods ─────────────────────────────────────────────────────────
export interface ModrinthProject {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  icon_url?: string | null;
  categories?: string[];
  versions?: string[];
  author?: string;
}

export interface InstalledAddon {
  filename: string;
  size: number;
  modifiedAt: string;
  enabled: boolean;
}

// ── nodes ──────────────────────────────────────────────────────────────────
export type NodeKind = 'local' | 'wings' | 'custom';

export interface PanelNode {
  id: string;
  name: string;
  kind: NodeKind;
  hostname: string;
  port?: number;
  online: boolean;
  serversCount: number;
  cpuPercent: number;
  cpuCores: number;
  ramTotalMb: number;
  ramUsedMb: number;
  diskTotalGb: number;
  diskUsedGb: number;
  uptimeSeconds?: number;
  platform?: string;
  version?: string;
  createdAt?: string;
}

export interface WingsNode {
  id: string;
  name: string;
  url: string; // https://node.example.com:8080
  token: string;
  createdAt: string;
}

export interface CustomNode {
  id: string;
  name: string;
  hostname: string;
  port?: number;
  createdAt: string;
}

// ── system ─────────────────────────────────────────────────────────────────
export interface SystemStats {
  cpuPercent: number;
  cpuCores: number;
  cpuModel: string;
  loadAverage: number[];
  ramTotalMb: number;
  ramFreeMb: number;
  ramUsedMb: number;
  diskTotalGb: number;
  diskFreeGb: number;
  diskUsedGb: number;
  uptimeSeconds: number;
  platform: string;
  hostname: string;
  panelVersion: string;
  dockerAvailable: boolean;
}

export interface UpdateStatus {
  running: boolean;
  step: string;
  progress: number;
  log: string[];
  finishedAt?: string;
  error?: string;
}

// ── api keys ───────────────────────────────────────────────────────────────
export type ApiKeyScope =
  | 'servers:read'
  | 'servers:write'
  | 'servers:power'
  | 'files:read'
  | 'files:write'
  | 'backups:read'
  | 'backups:write'
  | 'nodes:read'
  | 'admin';

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string; // sha256 of the full key
  scopes: ApiKeyScope[];
  owner: string;
  lastUsedAt?: string;
  createdAt: string;
}

export type PublicApiKey = Omit<ApiKey, 'keyHash'> & { key?: string };

// ── sftp ───────────────────────────────────────────────────────────────────
export interface SftpUser {
  serverId: string;
  username: string;
  password_hash: string;
  homePath: string;
  createdAt: string;
}

export interface SftpCredentials {
  host: string;
  port: number;
  username: string;
  password?: string; // only present right after (re)generation
  exists: boolean;
}

// ── playit ─────────────────────────────────────────────────────────────────
export interface PlayitTunnel {
  enabled: boolean;
  agentClaimUrl?: string;
  publicAddress?: string;
  tunnelId?: string;
  status?: 'pending' | 'active' | 'error' | 'disabled';
  updatedAt?: string;
}

// ── settings ───────────────────────────────────────────────────────────────
export type ThemeFamily = 'red' | 'blue' | 'green' | 'purple' | 'orange' | 'cyan' | 'pink' | 'zinc';

export interface PanelSettings {
  panelName: string;
  panelLogo: string;
  panelBackgroundImage: string;
  panelBackgroundBlur: number;
  enablePlayit: boolean;
  enableTutorial: boolean;
  enableLoginAnimation: boolean;
  enableRegistration: boolean;
  theme: ThemeFamily;
  enableGoogleLogin: boolean;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  firebaseAppId: string;
  firebaseMessagingSenderId: string;
  firebaseStorageBucket: string;
  defaultRuntime: 'docker' | 'local';
  runtimeLocked: boolean;
  isDev: boolean;
  panelVersion?: string;
  dockerAvailable?: boolean;
  sftpPort?: number;
}

// ── socket payloads ────────────────────────────────────────────────────────
export interface LogPayload {
  serverId: string;
  data: string;
}

export interface StatusPayload {
  serverId: string;
  status: ServerStatus;
}

export interface NotificationPayload {
  id: string;
  title: string;
  message: string;
  level: 'info' | 'success' | 'warn' | 'error';
  createdAt: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
