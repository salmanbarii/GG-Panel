import type { Response } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import type { PlayerInfo } from '../../types/index.js';
import { asyncHandler, httpError, requireString } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import { serverDir } from '../utils/paths.js';
import { getLogs, sendCommand } from '../services/serverService.js';
import { getRuntime } from '../runtime/runtimeFactory.js';

/**
 * Player list derived from the console log (join/leave lines), enriched with
 * ops.json / whitelist.json / banned-players.json.
 */

const JOIN_PATTERNS = [
  /\]:\s*([A-Za-z0-9_]{2,16})\s*(?:\[[^\]]*\])?\s*logged in with entity id/i,
  /\]:\s*([A-Za-z0-9_]{2,16}) joined the game/i,
];
const LEAVE_PATTERNS = [
  /\]:\s*([A-Za-z0-9_]{2,16}) left the game/i,
  /\]:\s*([A-Za-z0-9_]{2,16}) lost connection/i,
];

interface JsonPlayer {
  uuid?: string;
  name?: string;
  level?: number;
}

async function readJsonList(serverId: string, file: string): Promise<JsonPlayer[]> {
  const target = path.join(serverDir(serverId), file);
  if (!(await fs.pathExists(target))) return [];
  try {
    const data = await fs.readJson(target);
    return Array.isArray(data) ? (data as JsonPlayer[]) : [];
  } catch {
    return [];
  }
}

export function parsePlayersFromLog(log: string): PlayerInfo[] {
  const state = new Map<string, PlayerInfo>();

  for (const line of log.split('\n')) {
    for (const pattern of JOIN_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        state.set(match[1], { name: match[1], online: true, joinedAt: new Date().toISOString() });
      }
    }
    for (const pattern of LEAVE_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        const existing = state.get(match[1]);
        state.set(match[1], { name: match[1], online: false, joinedAt: existing?.joinedAt });
      }
    }
  }

  return [...state.values()].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** GET /api/servers/:id/players */
export const list = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const runtime = await getRuntime(server);
  const status = await runtime.getStatus(server);

  const log = await getLogs(server, 1500).catch(() => '');
  const parsed = status === 'online' ? parsePlayersFromLog(log) : [];

  const [ops, whitelist, banned] = await Promise.all([
    readJsonList(server.id, 'ops.json'),
    readJsonList(server.id, 'whitelist.json'),
    readJsonList(server.id, 'banned-players.json'),
  ]);

  const opNames = new Set(ops.map((o) => (o.name ?? '').toLowerCase()));
  const bannedNames = new Set(banned.map((b) => (b.name ?? '').toLowerCase()));

  res.json({
    isRunning: status === 'online',
    players: parsed.map((player) => ({
      ...player,
      isOp: opNames.has(player.name.toLowerCase()),
      isBanned: bannedNames.has(player.name.toLowerCase()),
    })),
    ops: ops.map((o) => o.name).filter(Boolean),
    whitelist: whitelist.map((w) => w.name).filter(Boolean),
    banned: banned.map((b) => b.name).filter(Boolean),
  });
});

const ACTIONS = {
  kick: (name: string, reason?: string) => `kick ${name}${reason ? ` ${reason}` : ''}`,
  ban: (name: string, reason?: string) => `ban ${name}${reason ? ` ${reason}` : ''}`,
  pardon: (name: string) => `pardon ${name}`,
  op: (name: string) => `op ${name}`,
  deop: (name: string) => `deop ${name}`,
  whitelistAdd: (name: string) => `whitelist add ${name}`,
  whitelistRemove: (name: string) => `whitelist remove ${name}`,
} as const;

type ActionName = keyof typeof ACTIONS;

/** POST /api/servers/:id/players/:action — kick, ban, pardon, op, deop, whitelist. */
export const action = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const name = requireString(req.body?.player ?? req.body?.name, 'player');

  if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) {
    throw httpError(400, 'Invalid Minecraft username');
  }

  const requested = String(req.params.action) as ActionName;
  const builder = ACTIONS[requested];
  if (!builder) throw httpError(400, `Unsupported action: ${requested}`);

  const reason =
    typeof req.body?.reason === 'string'
      ? req.body.reason.replace(/[\r\n]/g, ' ').slice(0, 120)
      : undefined;

  await sendCommand(server, builder(name, reason));
  res.json({ success: true, action: requested, player: name });
});
