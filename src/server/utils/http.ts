import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Error with an HTTP status attached. */
export class HttpError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function httpError(statusCode: number, message: string, details?: unknown): HttpError {
  return new HttpError(statusCode, message, details);
}

/** Wrap an async handler so rejections reach the express error middleware. */
export function asyncHandler<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req as unknown as Req, res, next)).catch(next);
  };
}

interface ErrorLike {
  statusCode?: number;
  status?: number;
  message?: string;
  details?: unknown;
  stack?: string;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const error = (err ?? {}) as ErrorLike;
  const status = error.statusCode ?? error.status ?? 500;
  const message = error.message || 'Internal server error';

  if (status >= 500) {
    console.error(`[api] ${req.method} ${req.originalUrl} → ${status}:`, error.stack ?? message);
  }

  if (res.headersSent) return;
  res.status(status).json({ error: message, ...(error.details ? { details: error.details } : {}) });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
}

/** Parse a positive integer from query/body input. */
export function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError(400, `${field} is required`);
  }
  return value.trim();
}
