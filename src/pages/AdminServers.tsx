import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, RefreshCw, Ban, UserCheck, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { SearchableDropdown, type DropdownOption } from '@/components/SearchableDropdown';
import { useAuth } from '@/context/AuthContext';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';
import type { GameServerView, PublicUser } from '@/types';

export default function AdminServersPage() {
  const { isAdmin } = useAuth();
  const { success, error: showError } = useToast();
  const { run, busy } = useAsyncAction();

  const [servers, setServers] = useState<GameServerView[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [suspendId, setSuspendId] = useState<string | null>(null);
  const [reassignId, setReassignId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [serversRes, usersRes] = await Promise.all([
        api.get<{ servers: GameServerView[] }>('/admin/servers'),
        api.get<{ users: PublicUser[] }>('/system/users'),
      ]);
      setServers(serversRes.data.servers);
      setUsers(usersRes.data.users);
    } catch (err) {
      const msg = errorMessage(err, 'Failed to load servers');
      setLoadError(msg);
      showError('Load failed', msg);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  const userOptions = useMemo<DropdownOption[]>(
    () => users.map((u) => ({ value: u.id, label: u.username })),
    [users],
  );

  const handleSuspend = useCallback(
    async (id: string, suspended: boolean) => {
      await run(
        async () => {
          const { data } = await api.put<{ server: GameServerView }>(`/servers/${id}/suspend`, {
            suspended,
          });
          setServers((curr) => curr.map((s) => (s.id === id ? data.server : s)));
          setSuspendId(null);
        },
        { successMessage: suspended ? 'Server suspended' : 'Server unsuspended' },
      );
    },
    [run],
  );

  const handleReassign = useCallback(
    async (id: string, ownerId: string) => {
      await run(
        async () => {
          const { data } = await api.put<{ server: GameServerView }>(`/servers/${id}/owner`, {
            ownerId,
          });
          setServers((curr) => curr.map((s) => (s.id === id ? data.server : s)));
          setReassignId(null);
        },
        { successMessage: 'Owner reassigned' },
      );
    },
    [run],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await run(
        async () => {
          await api.delete(`/servers/${id}`);
          setServers((curr) => curr.filter((s) => s.id !== id));
          setDeleteId(null);
        },
        { successMessage: 'Server deleted' },
      );
    },
    [run],
  );

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="All Servers" icon={<ShieldAlert className="h-5 w-5" />} />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card flex flex-col items-center justify-center gap-4 py-20 text-center"
        >
          <ShieldAlert className="h-12 w-12 text-zinc-600" />
          <p className="text-zinc-400">Admin only</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="All Servers"
        icon={<ShieldAlert className="h-5 w-5" />}
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="panel-btn-ghost gap-1.5 text-xs"
          >
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        }
      />

      {loading && servers.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <PremiumLoader label="Loading servers…" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <p className="text-sm text-red-300">{loadError}</p>
          <button type="button" onClick={() => void refresh()} className="panel-btn-primary text-xs">
            Retry
          </button>
        </div>
      ) : servers.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card flex flex-col items-center justify-center gap-4 py-20 text-center"
        >
          <ShieldAlert className="h-12 w-12 text-zinc-600" />
          <p className="text-zinc-400">No servers found</p>
        </motion.div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {servers.map((server, index) => (
              <motion.div
                key={server.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="panel-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">{server.name}</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {server.ownerUsername ?? 'Unknown'} · {server.runtimeType}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium',
                        server.suspended
                          ? 'border-red-500/30 bg-red-500/10 text-red-300'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
                      )}
                    >
                      {server.suspended ? 'Suspended' : 'Active'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                  <span>Port: {server.port}</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5',
                      server.isRunning
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-1.5 w-1.5 rounded-full',
                        server.isRunning ? 'bg-emerald-400' : 'bg-zinc-500',
                      )}
                    />
                    {server.isRunning ? 'Running' : 'Stopped'}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSuspendId(server.id)}
                    className="panel-btn-ghost gap-1.5 text-xs"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    {server.suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReassignId(server.id)}
                    className="panel-btn-ghost gap-1.5 text-xs"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Reassign
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(server.id)}
                    className="panel-btn-danger gap-1.5 text-xs"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={Boolean(reassignId)}
        onClose={() => setReassignId(null)}
        title="Reassign server owner"
        icon={<UserCheck className="h-4 w-4" />}
        footer={
          <button
            type="button"
            className="panel-btn-ghost"
            onClick={() => setReassignId(null)}
            disabled={busy}
          >
            Cancel
          </button>
        }
      >
        {reassignId && (
          <SearchableDropdown
            options={userOptions}
            onChange={(value) => {
              if (value) void handleReassign(reassignId, value);
            }}
            placeholder="Select new owner…"
            searchPlaceholder="Search users…"
            emptyMessage="No users found"
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(suspendId)}
        onClose={() => setSuspendId(null)}
        onConfirm={() => {
          const id = suspendId;
          if (!id) return;
          const target = servers.find((s) => s.id === id);
          void handleSuspend(id, !target?.suspended);
        }}
        title={suspendId && servers.find((s) => s.id === suspendId)?.suspended ? 'Unsuspend server?' : 'Suspend server?'}
        message="This will immediately change the server's suspension status."
        confirmLabel={suspendId && servers.find((s) => s.id === suspendId)?.suspended ? 'Unsuspend' : 'Suspend'}
        danger={!suspendId ? false : !servers.find((s) => s.id === suspendId)?.suspended}
        busy={busy}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && void handleDelete(deleteId)}
        title="Delete server"
        message={
          deleteId ? (
            <>
              This will permanently delete <span className="font-mono text-theme-400">{servers.find((s) => s.id === deleteId)?.name}</span> and all its data.
            </>
          ) : (
            'This will permanently delete the server and all its data.'
          )
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        requireText={deleteId ? servers.find((s) => s.id === deleteId)?.name : undefined}
      />
    </div>
  );
}
