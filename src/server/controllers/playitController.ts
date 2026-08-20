import type { Response } from 'express';
import { asyncHandler, httpError } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import { getSettings } from '../services/settingsStore.js';
import { isTunnelRunning, startTunnel, stopTunnel } from '../services/playitService.js';
import { patchServer } from '../services/serverStore.js';

/** playit.gg tunnels — only available when the admin enables the feature. */

async function assertEnabled(): Promise<void> {
  const settings = await getSettings();
  if (!settings.enablePlayit) {
    throw httpError(403, 'playit.gg integration is disabled by the administrator');
  }
}

/** GET /api/servers/:id/playit */
export const get = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const settings = await getSettings();
  res.json({
    enabled: settings.enablePlayit,
    running: isTunnelRunning(server.id),
    tunnel: server.playitTunnel ?? { enabled: false, status: 'disabled' },
  });
});

/** POST /api/servers/:id/playit — start/claim the tunnel. */
export const start = asyncHandler<ServerRequest>(async (req, res: Response) => {
  await assertEnabled();
  const server = currentServer(req);
  const tunnel = await startTunnel({ id: server.id, name: server.name, port: server.port });
  res.status(201).json({ tunnel, running: true });
});

/** DELETE /api/servers/:id/playit */
export const stop = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  await stopTunnel(server.id);
  res.json({ success: true });
});

/** PUT /api/servers/:id/playit — store a manually configured public address. */
export const update = asyncHandler<ServerRequest>(async (req, res: Response) => {
  await assertEnabled();
  const server = currentServer(req);
  const publicAddress =
    typeof req.body?.publicAddress === 'string' ? req.body.publicAddress.trim() : '';

  const updated = await patchServer(server.id, {
    playitTunnel: {
      ...(server.playitTunnel ?? { enabled: true }),
      enabled: true,
      publicAddress,
      status: publicAddress ? 'active' : 'pending',
      updatedAt: new Date().toISOString(),
    },
  });

  res.json({ tunnel: updated.playitTunnel });
});
