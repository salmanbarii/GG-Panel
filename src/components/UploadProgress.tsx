import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, X } from 'lucide-react';
import { useUploads } from '@/context/UploadContext';
import { cn } from '@/lib/format';

export function UploadProgress() {
  const { uploads, cancel, clearFinished } = useUploads();
  const [collapsed, setCollapsed] = useState(false);

  if (uploads.length === 0) return null;

  const visible = uploads.filter((u) => u.status === 'uploading' || u.status === 'queued');

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        className="fixed bottom-4 left-4 z-40 w-80 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-white">Uploads</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={clearFinished}
              className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-white/10 hover:text-white"
            >
              Clear finished
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="rounded-lg p-1 text-zinc-400 transition hover:bg-white/10 hover:text-white"
              aria-label={collapsed ? 'Expand uploads' : 'Collapse uploads'}
            >
              <motion.span animate={{ rotate: collapsed ? 0 : 180 }} transition={{ duration: 0.2 }}>
                <ChevronDown className="h-4 w-4" />
              </motion.span>
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {visible.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-zinc-500">No active uploads</div>
              ) : (
                <ul className="max-h-72 overflow-y-auto scrollbar-none divide-y divide-white/5">
                  {visible.map((task) => (
                    <li key={task.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-zinc-200" title={task.filename}>
                            {task.filename}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {task.status === 'queued' ? 'Queued' : `${Math.round(task.progress)}%`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancel(task.id)}
                          className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                          aria-label="Cancel upload"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {task.status === 'uploading' && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                          <motion.div
                            className="h-full rounded-full bg-theme-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${task.progress}%` }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
