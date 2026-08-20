import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserPlus,
  Trash2,
  Settings2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Shield,
  X,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { SearchableDropdown } from '@/components/SearchableDropdown';
import { cn } from '@/lib/format';
import type { GameServerView, SubUser, SubUserPermission, PublicUser } from '@/types';

interface SubUsersManagerProps {
  server: GameServerView;
  onRefresh?: () => void;
}

interface SubUsersResponse {
  subUsers: SubUser[];
  availablePermissions: SubUserPermission[];
}

interface UsersResponse {
  users: PublicUser[];
}

const PERMISSION_LABELS: Record<SubUserPermission, string> = {
  console: 'Console',
  files: 'Files',
  settings: 'Settings',
  backups: 'Backups',
  plugins: 'Plugins',
  players: 'Players',
  world: 'World',
  sftp: 'SFTP',
  power: 'Power',
};

const ALL_PERMISSIONS: SubUserPermission[] = [
  'console',
  'files',
  'settings',
  'backups',
  'plugins',
  'players',
  'world',
  'sftp',
  'power',
];

export function SubUsersManager({ server, onRefresh }: SubUsersManagerProps) {
  const { success, error } = useToast();
  const { busy } = useAsyncAction();

  const [subUsers, setSubUsers] = useState<SubUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availablePermissions, setAvailablePermissions] = useState<SubUserPermission[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<SubUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<SubUserPermission[]>(['console']);
  const [saving, setSaving] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const fetchSubUsers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<SubUsersResponse>(`/servers/${server.id}/subusers`);
      setSubUsers(data.subUsers);
      setAvailablePermissions(data.availablePermissions);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load sub-users'));
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const { data } = await api.get<UsersResponse>('/system/users');
      setUsers(data.users);
    } catch {
      error('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchSubUsers();
  }, [server.id]);

  const handleAdd = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      await api.post(`/servers/${server.id}/subusers`, {
        username: selectedUserId,
        permissions: selectedPermissions,
      });
      success('Sub-user added');
      setShowAddModal(false);
      setSelectedUserId('');
      setSelectedPermissions(['console']);
      fetchSubUsers();
      onRefresh?.();
    } catch (err) {
      error('Failed to add sub-user', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await api.put(`/servers/${server.id}/subusers/${editTarget.userId}`, {
        permissions: selectedPermissions,
      });
      success('Sub-user updated');
      setEditTarget(null);
      fetchSubUsers();
      onRefresh?.();
    } catch (err) {
      error('Failed to update sub-user', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/servers/${server.id}/subusers/${deleteTarget.userId}`);
      success('Sub-user removed');
      setDeleteTarget(null);
      fetchSubUsers();
      onRefresh?.();
    } catch (err) {
      error('Failed to remove sub-user', errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const openEdit = (sub: SubUser) => {
    setEditTarget(sub);
    setSelectedPermissions([...sub.permissions]);
  };

  const openAdd = async () => {
    setSelectedUserId('');
    setSelectedPermissions(['console']);
    await fetchUsers();
    setShowAddModal(true);
  };

  const userOptions = useMemo(
    () =>
      users
        .filter((u) => !subUsers.some((s) => s.userId === u.id))
        .map((u) => ({
          value: u.id,
          label: u.username,
        })),
    [users, subUsers],
  );

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm text-red-200">{loadError}</p>
          <button type="button" onClick={fetchSubUsers} className="panel-btn-ghost text-xs py-1.5">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <PremiumLoader label="Loading sub-users" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Sub-users</h3>
          <p className="text-xs text-zinc-500">
            {subUsers.length} sub-user{subUsers.length !== 1 ? 's' : ''} with access
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="panel-btn-primary gap-1.5 text-xs py-2"
        >
          <UserPlus className="h-4 w-4" /> Add sub-user
        </button>
      </div>

      {subUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <Shield className="h-10 w-10 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">No sub-users. Add one to grant limited access.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {subUsers.map((sub) => (
              <motion.div
                key={sub.userId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="panel-card flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-200">{sub.username}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {sub.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="rounded-md border border-theme-500/30 bg-theme-500/10 px-1.5 py-0.5 text-[10px] text-theme-300"
                      >
                        {PERMISSION_LABELS[perm] ?? perm}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(sub)}
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-theme-400"
                    aria-label="Edit sub-user"
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(sub)}
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-red-300"
                    aria-label="Remove sub-user"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add sub-user"
        description="Grant limited access to another panel user."
        size="md"
        footer={
          <>
            <button type="button" className="panel-btn-ghost" onClick={() => setShowAddModal(false)} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !selectedUserId}
              className="panel-btn-primary gap-1.5"
            >
              {saving && <Spinner />}
              Add
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="panel-label">User</label>
            <SearchableDropdown
              options={userOptions}
              value={selectedUserId}
              onChange={setSelectedUserId}
              placeholder="Select a user…"
              loading={loadingUsers}
              disabled={saving}
            />
          </div>
          <div>
            <label className="panel-label">Permissions</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_PERMISSIONS.map((perm) => (
                <label
                  key={perm}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 transition',
                    selectedPermissions.includes(perm)
                      ? 'border-theme-500/30 bg-theme-500/10'
                      : 'border-white/10 bg-black/40',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedPermissions.includes(perm)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPermissions((prev) => [...prev, perm]);
                      } else {
                        setSelectedPermissions((prev) => prev.filter((p) => p !== perm));
                      }
                    }}
                    className="rounded border-white/20 bg-black/40"
                  />
                  <span className="text-xs text-zinc-300">{PERMISSION_LABELS[perm]}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit ${editTarget?.username}`}
        size="md"
        footer={
          <>
            <button type="button" className="panel-btn-ghost" onClick={() => setEditTarget(null)} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleEditSave}
              disabled={saving}
              className="panel-btn-primary gap-1.5"
            >
              {saving && <Spinner />}
              Save
            </button>
          </>
        }
      >
        <div>
          <label className="panel-label">Permissions</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ALL_PERMISSIONS.map((perm) => (
              <label
                key={perm}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 transition',
                  selectedPermissions.includes(perm)
                    ? 'border-theme-500/30 bg-theme-500/10'
                    : 'border-white/10 bg-black/40',
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedPermissions.includes(perm)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedPermissions((prev) => [...prev, perm]);
                    } else {
                      setSelectedPermissions((prev) => prev.filter((p) => p !== perm));
                    }
                  }}
                  className="rounded border-white/20 bg-black/40"
                />
                <span className="text-xs text-zinc-300">{PERMISSION_LABELS[perm]}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remove sub-user"
        message={
          <span>
            Remove <strong>{deleteTarget?.username}</strong> from this server? They will lose all access immediately.
          </span>
        }
        confirmLabel="Remove"
        danger
        busy={deleteBusy}
      />
    </div>
  );
}
