import type { Response } from 'express';
import crypto from 'node:crypto';
import type { PanelSettings, UserRole } from '../../types/index.js';
import { asyncHandler, httpError, requireString } from '../utils/http.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { systemStats } from '../services/nodeService.js';
import {
  getUpdateStatus,
  rebootPanel,
  startUpdate,
  triggerWebhookUpdate,
} from '../services/updateService.js';
import { getSettings, saveSettings } from '../services/settingsStore.js';
import { config } from '../utils/config.js';
import { panelEvents } from '../utils/panelEvents.js';
import {
  createUser,
  deleteUser,
  findUserById,
  hashPassword,
  listPublicUsers,
  toPublicUser,
  updateUser,
} from '../services/userStore.js';
import { isDockerAvailable } from '../runtime/docker.js';
import { isAiEnabled } from '../services/aiService.js';

const ROLES: UserRole[] = ['user', 'admin', 'owner'];

/** GET /api/system/stats */
export const stats = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  res.json(await systemStats());
});

/** GET /api/settings — public: everything the login page needs. */
export const publicSettings = asyncHandler(async (_req, res: Response) => {
  const settings = await getSettings();
  res.json({
    ...settings,
    dockerAvailable: await isDockerAvailable(),
    aiEnabled: isAiEnabled(),
    panelVersion: config.panelVersion,
    sftpPort: config.sftpPort,
  });
});

/** PUT /api/system/settings — admin only. */
export const updateSettings = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const body = (req.body ?? {}) as Partial<PanelSettings>;

  if (body.panelBackgroundBlur !== undefined) {
    const blur = Number(body.panelBackgroundBlur);
    if (!Number.isFinite(blur) || blur < 0 || blur > 40) {
      throw httpError(400, 'Background blur must be between 0 and 40');
    }
    body.panelBackgroundBlur = blur;
  }

  if (body.theme !== undefined) {
    const allowed = ['red', 'blue', 'green', 'purple', 'orange', 'cyan', 'pink', 'zinc'];
    if (!allowed.includes(String(body.theme))) throw httpError(400, 'Unknown theme');
  }

  if (body.defaultRuntime !== undefined && !['docker', 'local'].includes(String(body.defaultRuntime))) {
    throw httpError(400, 'defaultRuntime must be "docker" or "local"');
  }

  for (const key of ['panelLogo', 'panelBackgroundImage'] as const) {
    const value = body[key];
    if (typeof value === 'string' && value.length > 6_000_000) {
      throw httpError(413, `${key} image is too large (max ~6 MB)`);
    }
  }

  const settings = await saveSettings(body);
  res.json({ settings });
});

/** POST /api/system/update */
export const update = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  res.status(202).json({ status: startUpdate() });
});

/** GET /api/system/update-status — SSE stream of update progress. */
export const updateStatusStream = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send(getUpdateStatus());

  const onUpdate = (payload: unknown) => send(payload);
  panelEvents.on('systemUpdate', onUpdate);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    panelEvents.off('systemUpdate', onUpdate);
    res.end();
  });
});

/** GET /api/system/update-status.json — one-shot status for polling clients. */
export const updateStatusJson = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  res.json(getUpdateStatus());
});

/** POST /api/system/reboot */
export const reboot = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  res.json({ success: true, message: 'Panel is restarting…' });
  rebootPanel(400);
});

/** POST /api/webhook/github-update — verifies the shared secret then updates. */
export const githubWebhook = asyncHandler(async (req, res: Response) => {
  const secret = config.githubWebhookSecret;
  if (!secret) throw httpError(503, 'Webhook updates are not configured');

  const provided =
    (req.headers['x-webhook-secret'] as string | undefined) ??
    (req.headers['x-hub-signature-256'] as string | undefined) ??
    (req.headers['x-gitlab-token'] as string | undefined) ??
    '';

  let authorized = false;

  if (provided.startsWith('sha256=')) {
    // GitHub HMAC signature over the raw body.
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    const digest = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
    authorized =
      digest.length === provided.length &&
      crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(provided));
  } else if (provided) {
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    authorized = a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (!authorized) throw httpError(401, 'Invalid webhook secret');

  triggerWebhookUpdate(1000);
  res.status(202).json({ success: true, message: 'Update scheduled' });
});

// ── user administration ────────────────────────────────────────────────────

/** GET /api/system/users */
export const listUsersHandler = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  res.json({ users: await listPublicUsers() });
});

/** POST /api/system/users */
export const createUserHandler = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const role = String(req.body?.role ?? 'user') as UserRole;
  if (!ROLES.includes(role)) throw httpError(400, 'Invalid role');
  if (role === 'owner' && req.user?.role !== 'owner') {
    throw httpError(403, 'Only the owner can create another owner');
  }

  const user = await createUser({
    username: requireString(req.body?.username, 'username'),
    password: requireString(req.body?.password, 'password'),
    email: typeof req.body?.email === 'string' ? req.body.email : undefined,
    role,
  });
  res.status(201).json({ user: toPublicUser(user) });
});

/** PUT /api/system/users/:id */
export const updateUserHandler = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const target = await findUserById(req.params.id);
  if (!target) throw httpError(404, 'User not found');

  const patch: Parameters<typeof updateUser>[1] = {};

  if (req.body?.role !== undefined) {
    const role = String(req.body.role) as UserRole;
    if (!ROLES.includes(role)) throw httpError(400, 'Invalid role');
    if (req.user?.role !== 'owner') {
      throw httpError(403, 'Only the owner can change roles');
    }
    if (target.role === 'owner' && role !== 'owner') {
      throw httpError(403, 'The owner role cannot be removed');
    }
    patch.role = role;
  }

  if (typeof req.body?.password === 'string' && req.body.password) {
    if (req.body.password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
    patch.password = await hashPassword(req.body.password);
  }

  if (typeof req.body?.username === 'string' && req.body.username.trim()) {
    patch.username = req.body.username.trim();
  }

  if (typeof req.body?.email === 'string') patch.email = req.body.email.trim() || undefined;

  const updated = await updateUser(target.id, patch);
  res.json({ user: toPublicUser(updated) });
});

/** DELETE /api/system/users/:id */
export const deleteUserHandler = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (req.user?.id === req.params.id) throw httpError(400, 'You cannot delete your own account');
  await deleteUser(req.params.id);
  res.json({ success: true });
});
