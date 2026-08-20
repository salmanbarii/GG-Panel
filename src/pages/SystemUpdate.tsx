import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Download, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import type { UpdateStatus } from '@/types';

export default function SystemUpdatePage() {
  const { isAdmin } = useAuth();
  const { settings } = useSettings();
  const { success, error: showError } = useToast();
  const { run, busy } = useAsyncAction();

  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get<UpdateStatus>('/system/update-status.json');
      setStatus(data);
      setLoadError(null);
    } catch (err) {
      const msg = errorMessage(err, 'Failed to load update status');
      setLoadError(msg);
      showError('Load failed', msg);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(() => {
      void fetchStatus();
    }, 1500);
    return () => clearInterval(id);
  }, [status?.running, fetchStatus]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [status?.log?.length]);

  const handleStart = useCallback(async () => {
    setUpdateOpen(false);
    setStarting(true);
    await run(
      async () => {
        const { data } = await api.post<{ status: UpdateStatus }>('/system/update');
        setStatus(data.status);
      },
      { successMessage: 'Update started' },
    );
    setStarting(false);
  }, [run]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="System Update" icon={<Download className="h-5 w-5" />} />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card flex flex-col items-center justify-center gap-4 py-20 text-center"
        >
          <Download className="h-12 w-12 text-zinc-600" />
          <p className="text-zinc-400">Admin only</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="System Update"
        icon={<Download className="h-5 w-5" />}
        description={`Panel version: ${settings.panelVersion ?? 'unknown'}`}
        actions={
          <button
            type="button"
            onClick={() => setUpdateOpen(true)}
            disabled={status?.running || starting || busy}
            className="panel-btn-primary gap-1.5 text-sm"
          >
            {status?.running || starting ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            {status?.running ? 'Updating…' : 'Start update'}
          </button>
        }
      />

      {loading && !status ? (
        <div className="flex items-center justify-center py-24">
          <PremiumLoader label="Checking update status…" />
        </div>
      ) : loadError && !status ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <p className="text-sm text-red-300">{loadError}</p>
          <button type="button" onClick={() => void fetchStatus()} className="panel-btn-primary text-xs">
            Retry
          </button>
        </div>
      ) : status ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card p-5 space-y-4"
        >
          {status.running && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-white">{status.step}</span>
                <span className="font-mono text-zinc-400">{status.progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <motion.div
                  className="h-full rounded-full bg-theme-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${status.progress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          )}

          {!status.running && status.finishedAt && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              Update finished
            </div>
          )}

          {status.error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {status.error}
            </div>
          )}

          <div
            ref={logRef}
            className="scrollbar-none h-80 overflow-y-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs leading-relaxed text-zinc-300"
          >
            {status.log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {status.log.length === 0 && (
              <p className="text-zinc-600">No logs yet.</p>
            )}
          </div>
        </motion.div>
      ) : null}

      <ConfirmDialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        onConfirm={() => void handleStart()}
        title="Start panel update"
        message="This will restart the panel. The update may take a few minutes."
        confirmLabel="Update"
        danger
        busy={busy}
      />
    </div>
  );
}
