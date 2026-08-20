import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/format';

/** Lightweight toast + notification store shared by every page. */

export type ToastLevel = 'info' | 'success' | 'warn' | 'error';

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  level: ToastLevel;
  createdAt: string;
  /** Toasts stay in the notification feed even after they disappear. */
  sticky?: boolean;
}

interface ToastContextValue {
  toasts: ToastItem[];
  notifications: ToastItem[];
  notify: (input: { title: string; message?: string; level?: ToastLevel; sticky?: boolean }) => string;
  success: (title: string, message?: string) => string;
  error: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
  dismiss: (id: string) => void;
  clearNotifications: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastLevel, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
};

const STYLES: Record<ToastLevel, string> = {
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  error: 'border-red-500/30 bg-red-500/10 text-red-200',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    ({
      title,
      message,
      level = 'info',
      sticky = false,
    }: {
      title: string;
      message?: string;
      level?: ToastLevel;
      sticky?: boolean;
    }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: ToastItem = { id, title, message, level, createdAt: new Date().toISOString(), sticky };

      setToasts((current) => [...current.slice(-4), item]);
      setNotifications((current) => [item, ...current].slice(0, 50));

      if (!sticky) {
        setTimeout(() => dismiss(id), level === 'error' ? 8000 : 4500);
      }
      return id;
    },
    [dismiss],
  );

  const success = useCallback(
    (title: string, message?: string) => notify({ title, message, level: 'success' }),
    [notify],
  );
  const error = useCallback(
    (title: string, message?: string) => notify({ title, message, level: 'error' }),
    [notify],
  );
  const info = useCallback(
    (title: string, message?: string) => notify({ title, message, level: 'info' }),
    [notify],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      notifications,
      notify,
      success,
      error,
      info,
      dismiss,
      clearNotifications: () => setNotifications([]),
    }),
    [toasts, notifications, notify, success, error, info, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.level];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-xl backdrop-blur-xl',
                STYLES[toast.level],
              )}
            >
              <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{toast.title}</p>
                {toast.message && (
                  <p className="mt-0.5 text-xs break-words opacity-90">{toast.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="rounded-md p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Convenience wrapper: run an async action and toast the outcome. */
export function useAsyncAction() {
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T,>(
      action: () => Promise<T>,
      options?: { successMessage?: string; errorMessage?: string; onDone?: (result: T) => void },
    ): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await action();
        if (options?.successMessage) success(options.successMessage);
        options?.onDone?.(result);
        return result;
      } catch (err) {
        error(
          options?.errorMessage ?? 'Action failed',
          err instanceof Error ? err.message : undefined,
        );
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [success, error],
  );

  return { run, busy };
}

/** Mirrors backend `notification` socket events into the toast feed. */
export function useSocketNotifications(socketEvents: {
  on: (event: string, handler: (payload: unknown) => void) => void;
  off: (event: string, handler: (payload: unknown) => void) => void;
}) {
  const { notify } = useToast();

  useEffect(() => {
    const handler = (payload: unknown) => {
      const data = payload as { title?: string; message?: string; level?: ToastLevel };
      if (!data?.title) return;
      notify({ title: data.title, message: data.message, level: data.level ?? 'info' });
    };
    socketEvents.on('notification', handler);
    return () => socketEvents.off('notification', handler);
  }, [notify, socketEvents]);
}
