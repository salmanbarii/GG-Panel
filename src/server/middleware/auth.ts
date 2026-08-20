import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { ApiKeyScope, PublicUser, UserRole } from '../../types/index.js';
import { config } from '../utils/config.js';
import { findUserById, isAdmin, toPublicUser } from '../services/userStore.js';
import { touchApiKey, verifyApiKey } from '../services/apiKeyStore.js';

export interface AuthedRequest extends Request {
  user?: PublicUser;
  apiKeyScopes?: ApiKeyScope[];
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

export function signToken(user: { id: string; username: string; role: UserRole }): string {
  const payload: JwtPayload = { sub: user.id, username: user.username, role: user.role };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

export function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken) return queryToken;
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.token;
  if (cookieToken) return cookieToken;
  return undefined;
}

/**
 * Accepts either a JWT (`Authorization: Bearer <jwt>`) or a panel API key
 * (`X-API-Key: gg_...`). API keys resolve to their owning user plus scopes.
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const apiKeyHeader = (req.headers['x-api-key'] ?? req.headers['x-apikey']) as string | undefined;
    if (apiKeyHeader) {
      const match = await verifyApiKey(apiKeyHeader);
      if (!match) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }
      const user = await findUserById(match.owner);
      if (!user) {
        res.status(401).json({ error: 'API key owner no longer exists' });
        return;
      }
      req.user = toPublicUser(user);
      req.apiKeyScopes = match.scopes;
      void touchApiKey(match.id);
      next();
      return;
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const payload = verifyToken(token);
    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Account no longer exists' });
      return;
    }
    req.user = toPublicUser(user);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: 'Administrator access required' });
    return;
  }
  next();
}

export function requireOwnerRole(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'owner') {
    res.status(403).json({ error: 'Owner access required' });
    return;
  }
  next();
}

/** Enforce an API-key scope. JWT sessions are unrestricted by design. */
export function requireScope(scope: ApiKeyScope) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.apiKeyScopes) {
      next();
      return;
    }
    if (req.apiKeyScopes.includes('admin') || req.apiKeyScopes.includes(scope)) {
      next();
      return;
    }
    res.status(403).json({ error: `API key missing required scope: ${scope}` });
  };
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
