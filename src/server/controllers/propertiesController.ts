import type { Response } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import { asyncHandler, httpError } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import { serverDir } from '../utils/paths.js';

/** Key/value editor for server.properties. */

function propsPath(serverId: string): string {
  return path.join(serverDir(serverId), 'server.properties');
}

export function parseProperties(raw: string): {
  entries: { key: string; value: string }[];
  comments: string[];
} {
  const entries: { key: string; value: string }[] = [];
  const comments: string[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      comments.push(trimmed);
      continue;
    }
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    entries.push({
      key: trimmed.slice(0, index).trim(),
      value: trimmed.slice(index + 1).trim(),
    });
  }

  return { entries, comments };
}

export function serializeProperties(
  entries: { key: string; value: string }[],
  comments: string[] = [],
): string {
  return [
    ...(comments.length ? comments : ['#Minecraft server properties']),
    ...entries.map(({ key, value }) => `${key}=${value}`),
    '',
  ].join('\n');
}

/** GET /api/servers/:id/properties */
export const get = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const file = propsPath(server.id);

  if (!(await fs.pathExists(file))) {
    res.json({ exists: false, properties: {}, entries: [] });
    return;
  }

  const raw = await fs.readFile(file, 'utf8');
  const { entries } = parseProperties(raw);
  res.json({
    exists: true,
    entries,
    properties: Object.fromEntries(entries.map((e) => [e.key, e.value])),
  });
});

/**
 * PUT /api/servers/:id/properties
 * Body: `{ properties: { key: value } }` — merges into the existing file and
 * preserves comments plus key order.
 */
export const update = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const file = propsPath(server.id);

  const incoming = req.body?.properties;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw httpError(400, 'properties must be an object of key/value pairs');
  }

  const raw = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf8') : '';
  const { entries, comments } = parseProperties(raw);

  const patch = new Map<string, string>(
    Object.entries(incoming as Record<string, unknown>).map(([key, value]) => [
      key.trim(),
      String(value ?? '').replace(/[\r\n]/g, ''),
    ]),
  );

  // Reject keys that would corrupt the file format.
  for (const key of patch.keys()) {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw httpError(400, `Invalid property key: ${key}`);
  }

  const merged = entries.map((entry) => {
    if (!patch.has(entry.key)) return entry;
    const value = patch.get(entry.key) as string;
    patch.delete(entry.key);
    return { key: entry.key, value };
  });

  for (const [key, value] of patch) merged.push({ key, value });

  // Keep the panel's stored port in sync when the user edits server-port.
  const portEntry = merged.find((e) => e.key === 'server-port');
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, serializeProperties(merged, comments), 'utf8');

  res.json({
    success: true,
    entries: merged,
    properties: Object.fromEntries(merged.map((e) => [e.key, e.value])),
    portMismatch: portEntry ? Number(portEntry.value) !== server.port : false,
    note: 'Restart the server for changes to take effect.',
  });
});
