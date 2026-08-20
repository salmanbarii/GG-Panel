import { spawn } from 'node:child_process';
import type { UpdateStatus } from '../../types/index.js';
import { ROOT_DIR } from '../utils/paths.js';
import { panelEvents } from '../utils/panelEvents.js';

/**
 * Panel self-update: runs `bash update.sh` and streams progress to both the SSE
 * endpoint and the `systemUpdate` socket event.
 */

const MAX_LOG_LINES = 500;

const state: UpdateStatus = {
  running: false,
  step: 'idle',
  progress: 0,
  log: [],
};

/** Rough progress mapping keyed off the well-known update.sh steps. */
const STEP_PROGRESS: { match: RegExp; step: string; progress: number }[] = [
  { match: /git pull|fetching|pulling/i, step: 'Pulling changes', progress: 20 },
  { match: /npm install|installing dependencies/i, step: 'Installing dependencies', progress: 45 },
  { match: /build:client|vite build|building/i, step: 'Building frontend', progress: 65 },
  { match: /build:server|esbuild/i, step: 'Building backend', progress: 80 },
  { match: /pm2 restart|restarting/i, step: 'Restarting panel', progress: 95 },
];

function publish(): void {
  panelEvents.emitTyped('systemUpdate', { ...state, log: [...state.log] });
}

function pushLog(chunk: string): void {
  const lines = chunk.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines) {
    state.log.push(line);
    for (const rule of STEP_PROGRESS) {
      if (rule.match.test(line) && rule.progress > state.progress) {
        state.progress = rule.progress;
        state.step = rule.step;
      }
    }
  }
  if (state.log.length > MAX_LOG_LINES) {
    state.log = state.log.slice(-MAX_LOG_LINES);
  }
  publish();
}

export function getUpdateStatus(): UpdateStatus {
  return { ...state, log: [...state.log] };
}

export function startUpdate(): UpdateStatus {
  if (state.running) return getUpdateStatus();

  state.running = true;
  state.step = 'Starting update';
  state.progress = 5;
  state.log = ['[update] starting panel update…'];
  state.error = undefined;
  state.finishedAt = undefined;
  publish();

  const child = spawn('bash', ['update.sh'], {
    cwd: ROOT_DIR,
    env: { ...process.env, CI: 'true' },
  });

  child.stdout.on('data', (data: Buffer) => pushLog(data.toString()));
  child.stderr.on('data', (data: Buffer) => pushLog(data.toString()));

  child.on('error', (err) => {
    state.running = false;
    state.error = err.message;
    state.step = 'Failed';
    state.finishedAt = new Date().toISOString();
    pushLog(`[update] failed to launch update.sh: ${err.message}`);
  });

  child.on('close', (code) => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    if (code === 0) {
      state.progress = 100;
      state.step = 'Completed';
      pushLog('[update] update finished successfully');
    } else {
      state.step = 'Failed';
      state.error = `update.sh exited with code ${code}`;
      pushLog(`[update] update failed (exit code ${code})`);
    }
  });

  return getUpdateStatus();
}

/**
 * Restart the panel process. Under pm2/systemd the supervisor brings it back;
 * standalone runs simply exit so the operator can restart manually.
 */
export function rebootPanel(delayMs = 500): void {
  setTimeout(() => {
    console.log('[system] reboot requested — exiting for the supervisor to restart');
    process.exit(0);
  }, delayMs);
}

/** Fire-and-forget update used by the GitHub webhook. */
export function triggerWebhookUpdate(delayMs = 1000): void {
  setTimeout(() => {
    startUpdate();
  }, delayMs);
}
