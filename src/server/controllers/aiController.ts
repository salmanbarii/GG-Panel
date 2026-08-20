import type { Response } from 'express';
import { asyncHandler, httpError, requireString } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  analyzeCrash,
  askAssistant,
  explainProperty,
  isAiEnabled,
  suggestOptimizations,
} from '../services/aiService.js';
import { getLogs, getStats } from '../services/serverService.js';

/** Gemini-backed helpers. All endpoints 503 when GEMINI_API_KEY is unset. */

function assertEnabled(): void {
  if (!isAiEnabled()) {
    throw httpError(503, 'AI features are disabled — set GEMINI_API_KEY to enable them.');
  }
}

/** GET /api/ai/status */
export const status = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  res.json({ enabled: isAiEnabled() });
});

/** POST /api/servers/:id/ai/analyze — diagnose the latest console output. */
export const analyze = asyncHandler<ServerRequest>(async (req, res: Response) => {
  assertEnabled();
  const server = currentServer(req);
  const log =
    typeof req.body?.log === 'string' && req.body.log.trim()
      ? req.body.log
      : await getLogs(server, 400);

  if (!log.trim()) throw httpError(400, 'There is no console output to analyse yet');

  const answer = await analyzeCrash(log, {
    serverType: server.serverType,
    version: server.version,
    ram: server.ram,
  });
  res.json({ answer });
});

/** POST /api/servers/:id/ai/optimize */
export const optimize = asyncHandler<ServerRequest>(async (req, res: Response) => {
  assertEnabled();
  const server = currentServer(req);
  const stats = await getStats(server).catch(() => null);

  const answer = await suggestOptimizations({
    serverType: server.serverType,
    version: server.version,
    ram: server.ram,
    cpu: server.cpu,
    players: stats?.players?.length ?? 0,
    properties:
      req.body?.properties && typeof req.body.properties === 'object'
        ? (req.body.properties as Record<string, string>)
        : undefined,
  });
  res.json({ answer });
});

/** POST /api/ai/explain-property */
export const explain = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  assertEnabled();
  const key = requireString(req.body?.key, 'key');
  const value = String(req.body?.value ?? '');
  res.json({ answer: await explainProperty(key, value) });
});

/** POST /api/ai/ask */
export const ask = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  assertEnabled();
  const question = requireString(req.body?.question, 'question');
  const context = typeof req.body?.context === 'string' ? req.body.context : undefined;
  res.json({ answer: await askAssistant(question, context) });
});
