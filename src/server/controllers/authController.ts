import type { Response } from 'express';
import type { AuthResponse } from '../../types/index.js';
import { asyncHandler, httpError, requireString } from '../utils/http.js';
import { signToken, type AuthedRequest } from '../middleware/auth.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  hashPassword,
  listUsers,
  toPublicUser,
  updateUser,
  verifyPassword,
} from '../services/userStore.js';
import { getSettings } from '../services/settingsStore.js';

/** POST /api/auth/register */
export const register = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const settings = await getSettings();
  const users = await listUsers();

  // Registration can be disabled, but the very first (owner) account is always allowed.
  if (!settings.enableRegistration && users.length > 0) {
    throw httpError(403, 'Registration is disabled on this panel');
  }

  const username = requireString(req.body?.username, 'Username');
  const password = requireString(req.body?.password, 'Password');
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : undefined;

  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');

  const user = await createUser({ username, password, email });
  const payload: AuthResponse = { token: signToken(user), user: toPublicUser(user) };
  res.status(201).json(payload);
});

/** POST /api/auth/login — password or Firebase/Google identity. */
export const login = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const { username, password, googleId, email, avatar } = req.body ?? {};

  // ── Google / Firebase login ──────────────────────────────────────────────
  if (googleId) {
    const settings = await getSettings();
    if (!settings.enableGoogleLogin) throw httpError(403, 'Google login is disabled');

    const identifier = String(googleId);
    const users = await listUsers();
    let user = users.find((u) => u.googleId === identifier);

    if (!user && typeof email === 'string' && email) {
      user = await findUserByEmail(email);
      if (user) user = await updateUser(user.id, { googleId: identifier });
    }

    if (!user) {
      if (!settings.enableRegistration && users.length > 0) {
        throw httpError(403, 'This Google account is not linked to a panel user');
      }
      const base = (typeof email === 'string' && email.split('@')[0]) || `user${Date.now()}`;
      let candidate = base.replace(/[^a-z0-9_.-]/gi, '') || `user${Date.now()}`;
      if (candidate.length < 3) candidate = `${candidate}user`;
      while (await findUserByUsername(candidate)) {
        candidate = `${candidate}${Math.floor(Math.random() * 10)}`;
      }
      user = await createUser({
        username: candidate,
        password: '',
        email: typeof email === 'string' ? email : undefined,
        googleId: identifier,
        avatar: typeof avatar === 'string' ? avatar : undefined,
      });
    }

    const payload: AuthResponse = { token: signToken(user), user: toPublicUser(user) };
    res.json(payload);
    return;
  }

  // ── Username + password ──────────────────────────────────────────────────
  const name = requireString(username, 'Username');
  const secret = requireString(password, 'Password');

  const user = (await findUserByUsername(name)) ?? (await findUserByEmail(name));
  if (!user || !user.password) throw httpError(401, 'Invalid username or password');

  const ok = await verifyPassword(secret, user.password);
  if (!ok) throw httpError(401, 'Invalid username or password');

  const payload: AuthResponse = { token: signToken(user), user: toPublicUser(user) };
  res.json(payload);
});

/** GET /api/auth/me */
export const me = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  const user = await findUserById(req.user.id);
  if (!user) throw httpError(401, 'Account no longer exists');
  res.json({ user: toPublicUser(user) });
});

/** PUT /api/auth/me — username, password and avatar changes. */
export const updateMe = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  const user = await findUserById(req.user.id);
  if (!user) throw httpError(401, 'Account no longer exists');

  const patch: Parameters<typeof updateUser>[1] = {};
  const { username, password, currentPassword, avatar, email } = req.body ?? {};

  if (typeof username === 'string' && username.trim() && username.trim() !== user.username) {
    const desired = username.trim();
    if (desired.length < 3) throw httpError(400, 'Username must be at least 3 characters');
    const clash = await findUserByUsername(desired);
    if (clash && clash.id !== user.id) throw httpError(409, 'Username already taken');
    patch.username = desired;
  }

  if (typeof password === 'string' && password) {
    if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
    // Users with a local password must confirm it; Google-only accounts may set one.
    if (user.password) {
      const confirmed = await verifyPassword(String(currentPassword ?? ''), user.password);
      if (!confirmed) throw httpError(403, 'Current password is incorrect');
    }
    patch.password = await hashPassword(password);
  }

  if (typeof avatar === 'string') {
    if (avatar.length > 3_000_000) throw httpError(413, 'Avatar image is too large (max ~3 MB)');
    patch.avatar = avatar;
  }

  if (typeof email === 'string') patch.email = email.trim() || undefined;

  const updated = await updateUser(user.id, patch);
  res.json({ user: toPublicUser(updated), token: signToken(updated) });
});
