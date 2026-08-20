import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HardDrive,
  Download,
  Trash2,
  RotateCcw,
  Plus,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Play,
} from 'lucide-react';
import { api, getToken, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { cn, formatBytes, formatDate, timeAgo } from '@/lib/format';
import type { BackupEntry } from '@/types';

import type { GameServerView } from '@/types';

interface ServerBackupsProps {
  server: GameServerView;
  onRefresh?: () => void;
}

interface BackupsResponse {
  backups: BackupEntry[];
}

export function ServerBackups({ server, onRefresh }: ServerBackupsProps) {
  const { success, error } = useToast();
  const { run, busy } = useAsyncAction();

  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [lean, setLean] = useState(false);
  const [createProgress, setCreateProgress] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreForce, setRestoreForce] = useState(false);
  const [restore409, setRestore409] = useState(false);

  const fetchBackups = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<BackupsResponse>(`/servers/${server.id}/backups`);
      setBackups(data.backups);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load backups'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, [server.id]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateProgress('Starting backup…');
    try {
      await api.post(`/servers/${server.id}/backups`, { lean });
      setCreateProgress(null);
      success('Backup created');
      fetchBackups();
      onRefresh?.();
    } catch (err) {
      setCreateProgress(null);
      error('Failed to create backup', errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/servers/${server.id}/backups/${deleteTarget}`);
      success('Backup deleted');
      setDeleteTarget(null);
      fetchBackups();
      onRefresh?.();
    } catch (err) {
      error('Failed to delete backup', errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setRestoreBusy(true);
    setRestore409(false);
    try {
      await api.post(`/servers/${server.id}/backups/${restoreTarget}/restore`, { force: restoreForce });
      success('Backup restored');
      setRestoreTarget(null);
      setRestoreForce(false);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 409 && !restoreForce) {
        setRestore409(true);
      } else {
        error('Failed to restore backup', errorMessage(err));
        setRestoreTarget(null);
        setRestoreForce(false);
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleDownload = (filename: string) => {
    const token = getToken();
    const url = `/api/servers/${server.id}/backups/${encodeURIComponent(filename)}?token=${token}`;
    window.open(url, '_blank');
  };

  const totalSize = backups.reduce((sum, b) => sum + b.size, 0);
  const isRunning = server.isRunning;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Backups</h3>
          <p className="text-xs text-zinc-500">
            {backups.length} backup{backups.length !== 1 ? 's' : ''} · {formatBytes(totalSize)} total
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="panel-btn-primary gap-1.5 text-xs py-2"
        >
          {creating ? <Spinner /> : <Plus className="h-4 w-4" />}
          {creating ? (createProgress ?? 'Creating…') : 'Create backup'}
        </button>
      </div>

      {creating && (
        <div className="flex items-center gap-3 rounded-xl border border-theme-500/30 bg-theme-500/10 p-3">
          <Loader2 className="h-5 w-5 animate-spin text-theme-400" />
          <span className="text-sm text-theme-300">{createProgress ?? 'Creating backup…'}</span>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={lean}
          onChange={(e) => setLean(e.target.checked)}
          className="rounded border-white/20 bg-black/40"
        />
        Lean backup (skips cache/libraries — smaller and faster)
      </label>

      {loadError && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm text-red-200">{loadError}</p>
          <button type="button" onClick={fetchBackups} className="panel-btn-ghost text-xs py-1.5">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <PremiumLoader label="Loading backups" />
        </div>
      ) : backups.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <HardDrive className="h-10 w-10 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">No backups yet. Create your first backup to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {backups.map((backup) => (
              <motion.div
                key={backup.filename}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="panel-card flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-200">{backup.filename}</p>
                  <p className="text-xs text-zinc-500">
                    {formatBytes(backup.size)} · {formatDate(backup.createdAt)} · {timeAgo(backup.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleDownload(backup.filename)}
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                    aria-label="Download backup"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRestoreTarget(backup.filename); setRestore409(false); }}
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                    aria-label="Restore backup"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(backup.filename)}
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-red-300"
                    aria-label="Delete backup"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete backup"
        message={
          <span>
            This permanently removes <strong>{deleteTarget}</strong>. This action cannot be undone.
          </span>
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
      />

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => { setRestoreTarget(null); setRestoreForce(false); setRestore409(false); }}
        onConfirm={handleRestore}
        title="Restore backup"
        message={
          <div className="space-y-3">
            <p>
              Restoring <strong>{restoreTarget}</strong> will overwrite all current server files. Are you sure?
            </p>
            {isRunning && !restoreForce && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-sm text-amber-200">
                  The server is currently running. Restoring requires the server to be stopped.
                </p>
              </div>
            )}
            {restore409 && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <p className="text-sm text-red-200">
                  The server must be stopped before restoring. Stop the server and retry, or use the force option below.
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={restoreForce}
                onChange={(e) => setRestoreForce(e.target.checked)}
                className="rounded border-white/20 bg-black/40"
              />
              Force restore (stop server and restore)
            </label>
          </div>
        }
        confirmLabel="Restore"
        danger
        busy={restoreBusy}
        requireText={server.name}
      />
    </div>
  );
}
