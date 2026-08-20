import axios, { AxiosError, type AxiosInstance } from 'axios';

/**
 * Shared axios instance. The interceptor injects the JWT on every request and
 * bubbles a clean `message` up to the UI.
 */

const TOKEN_KEY = 'jtg_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 120_000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string }>) => {
    const status = error.response?.status;
    const message =
      error.response?.data?.error ??
      (status === 0 || error.code === 'ERR_NETWORK'
        ? 'Cannot reach the panel server'
        : error.message);

    if (status === 401 && !error.config?.url?.includes('/auth/login')) {
      onUnauthorized?.();
    }

    return Promise.reject(Object.assign(new Error(message), { status, cause: error }));
  },
);

/** Pull a human readable message out of anything thrown by axios. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}
