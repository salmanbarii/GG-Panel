import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { cn, timeAgo } from '@/lib/format';

const LEVEL_DOT: Record<string, string> = {
  info: 'bg-sky-400',
  success: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-red-400',
};

export function NotificationsDropdown() {
  const { notifications, dismiss, clearNotifications } = useToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const unreadCount = Math.min(notifications.length, 99);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-theme-600 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/98 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="text-sm font-semibold text-white">Notifications</span>
              <button
                type="button"
                onClick={clearNotifications}
                className="text-xs text-zinc-400 transition hover:text-white"
              >
                Clear all
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto scrollbar-none">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-sm text-zinc-500">No notifications</div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {notifications.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => dismiss(item.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/5"
                      >
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', LEVEL_DOT[item.level] ?? 'bg-zinc-400')} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-200">{item.title}</p>
                          {item.message && <p className="mt-0.5 text-xs text-zinc-400 break-words">{item.message}</p>}
                          <p className="mt-1 text-[10px] text-zinc-500">{timeAgo(item.createdAt)}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
