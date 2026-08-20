import fs from 'fs-extra';
import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT_DIR } from './paths.js';

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';

function readPanelVersion(): string {
  try {
    const pkg = fs.readJsonSync(path.join(ROOT_DIR, 'package.json')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const config = {
  isDev,
  port: int(process.env.PORT, 6767),
  jwtSecret: process.env.JWT_SECRET || 'gg-panel-insecure-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  enableDocker: bool(process.env.ENABLE_DOCKER, true),
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  defaultRuntime: (process.env.DEFAULT_RUNTIME === 'local' ? 'local' : 'docker') as
    | 'docker'
    | 'local',
  runtimeLocked: bool(process.env.PANEL_RUNTIME_LOCKED, false),
  /** 6868 in production, 6869 in dev so both can run side by side. */
  sftpPort: int(process.env.SFTP_PORT, isDev ? 6869 : 6868),
  sftpHost: process.env.SFTP_HOST || '0.0.0.0',
  publicHost: process.env.PUBLIC_HOST || '',
  panelVersion: readPanelVersion(),
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 8 * 1024 * 1024 * 1024),
  dockerImage: process.env.DOCKER_MC_IMAGE || 'itzg/minecraft-server:latest',
};

export type PanelConfig = typeof config;
