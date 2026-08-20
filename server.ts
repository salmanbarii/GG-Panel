import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs-extra';
import { config } from './src/server/utils/config.js';
import {
  CLIENT_DIST_DIR,
  DATA_DIR,
  ROOT_DIR,
  ensureDataDirs,
} from './src/server/utils/paths.js';
import { FILES, ensureJSONFile } from './src/server/utils/jsonStore.js';
import { defaultSettings } from './src/server/services/settingsStore.js';
import { createApiRouter } from './src/server/routes/index.js';
import { errorHandler } from './src/server/utils/http.js';
import { createSocketServer } from './src/server/socket.js';
import { startSftpServer, stopSftpServer } from './src/server/services/sftp.js';
import { isDockerAvailable } from './src/server/runtime/docker.js';
import { killAllLocalProcesses } from './src/server/runtime/local.js';
import { stopAllTunnels } from './src/server/services/playitService.js';

/**
 * JTG Panel — single unified server.
 *   • Express REST API under /api
 *   • Socket.IO for console streaming
 *   • Vite middleware in dev, static dist/client in production
 *   • Built-in SFTP server on its own port
 */

async function bootstrapData(): Promise<void> {
  await ensureDataDirs();
  await Promise.all([
    ensureJSONFile(FILES.users, []),
    ensureJSONFile(FILES.servers, []),
    ensureJSONFile(FILES.settings, defaultSettings()),
    ensureJSONFile(FILES.nodes, []),
    ensureJSONFile(FILES.wingsNodes, []),
    ensureJSONFile(FILES.sftpUsers, []),
    ensureJSONFile(FILES.apiKeys, []),
  ]);
  console.log(`[panel] data directory ready at ${DATA_DIR}`);
}

async function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());

  // Keep the raw body around so the GitHub webhook can verify its HMAC.
  app.use(
    express.json({
      limit: '25mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // ── health ───────────────────────────────────────────────────────────────
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: config.panelVersion,
      env: config.isDev ? 'development' : 'production',
      uptime: Math.round(process.uptime()),
    });
  });

  // ── api ──────────────────────────────────────────────────────────────────
  app.use('/api', createApiRouter());
  app.use('/api', errorHandler);

  // ── frontend ─────────────────────────────────────────────────────────────
  if (config.isDev) {
    // Vite is a devDependency: only import it when actually running in dev.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: ROOT_DIR,
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.use('*', async (req: Request, res: Response, next) => {
      try {
        const template = await fs.readFile(path.join(ROOT_DIR, 'index.html'), 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });

    console.log('[panel] vite dev middleware attached');
  } else {
    if (!(await fs.pathExists(CLIENT_DIST_DIR))) {
      console.warn(
        `[panel] ${CLIENT_DIST_DIR} is missing — run "npm run build" to build the frontend.`,
      );
    }

    app.use(
      express.static(CLIENT_DIST_DIR, {
        index: false,
        maxAge: '1y',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );

    // SPA fallback: every non-API route renders index.html.
    app.get('*', async (_req: Request, res: Response) => {
      const indexFile = path.join(CLIENT_DIST_DIR, 'index.html');
      if (await fs.pathExists(indexFile)) {
        res.sendFile(indexFile);
        return;
      }
      res
        .status(503)
        .send('<h1>JTG Panel</h1><p>Frontend build missing. Run <code>npm run build</code>.</p>');
    });
  }

  app.use(errorHandler);
  return app;
}

async function main(): Promise<void> {
  await bootstrapData();

  const app = await createApp();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const dockerReady = await isDockerAvailable();

  console.log('');
  console.log('  ╭───────────────────────────────────────────────╮');
  console.log('  │            JTG Panel is running               │');
  console.log('  ╰───────────────────────────────────────────────╯');
  console.log(`  Panel      http://localhost:${config.port}`);
  console.log(`  Mode       ${config.isDev ? 'development' : 'production'}`);
  console.log(`  Runtime    default=${config.defaultRuntime} docker=${dockerReady ? 'up' : 'down'}`);
  console.log(`  Version    ${config.panelVersion}`);
  console.log('');

  // ── SFTP ─────────────────────────────────────────────────────────────────
  try {
    await startSftpServer();
  } catch (err) {
    console.error(
      `[sftp] failed to start on port ${config.sftpPort}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // ── graceful shutdown ────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[panel] ${signal} received — shutting down`);

    const timer = setTimeout(() => process.exit(1), 10_000);
    try {
      await stopAllTunnels().catch(() => undefined);
      await stopSftpServer().catch(() => undefined);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      // Local game servers are children of this process — stop them cleanly.
      await killAllLocalProcesses().catch(() => undefined);
    } finally {
      clearTimeout(timer);
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[panel] unhandled rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[panel] uncaught exception:', err);
  });
}

main().catch((err) => {
  console.error('[panel] fatal startup error:', err);
  process.exit(1);
});
