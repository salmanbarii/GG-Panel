import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, Plus, RefreshCw, Trash2, Copy, Check } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { useAuth } from '@/context/AuthContext';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { cn, timeAgo, copyToClipboard } from '@/lib/format';
import type { PublicApiKey, ApiKeyScope } from '@/types';

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  'servers:read': 'Read servers',
  'servers:write': 'Write servers',
  'servers:power': 'Server power',
  'files:read': 'Read files',
  'files:write': 'Write files',
  'backups:read': 'Read backups',
  'backups:write': 'Write backups',
  'nodes:read': 'Read nodes',
  'admin': 'Admin',
};

const SCOPE_OPTIONS: ApiKeyScope[] = [
  'servers:read',
  'servers:write',
  'servers:power',
  'files:read',
  'files:write',
  'backups:read',
  'backups:write',
  'nodes:read',
  'admin',
];

const SCOPE_BADGE_TONE: Record<string, string> = {
  'servers:read': 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  'servers:write': 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  'servers:power': 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  'files:read': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  'files:write': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  'backups:read': 'border-purple-500/30 bg-purple-500/10 text-purple-200',
  'backups:write': 'border-purple-500/30 bg-purple-500/10 text-purple-200',
  'nodes:read': 'border-orange-500/30 bg-orange-500/10 text-orange-200',
  'admin': 'border-red-500/30 bg-red-500/10 text-red-200',
};

export default function ApiKeysPage() {
  const { isAdmin } = useAuth();
  const { success, error: showError } = useToast();
  const { run, busy } = useAsyncAction();

  const [keys, setKeys] = useState<PublicApiKey[]>([]);
  const [availableScopes, setAvailableScopes] = useState<ApiKeyScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>(['servers:read']);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const endpoints = ['/admin/api-keys', '/api-keys'];
      let lastErr: unknown = null;
      for (const ep of endpoints) {
        try {
          const { data } = await api.get<{ keys: PublicApiKey[]; availableScopes: ApiKeyScope[] }>(ep);
          setKeys(data.keys);
          setAvailableScopes(data.availableScopes);
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    } catch (err) {
      const msg = errorMessage(err, 'Failed to load API keys');
      setLoadError(msg);
      showError('Load failed', msg);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  const handleCreate = useCallback(async () => {
    if (!newKeyName.trim()) return;
    await run(
      async () => {
        const { data } = await api.post<{ key: PublicApiKey & { key: string }; warning: string }>(
          '/admin/api-keys',
          { name: newKeyName.trim(), scopes: selectedScopes },
        );
        setCreatedKey(data.key.key);
        setNewKeyName('');
        setSelectedScopes(['servers:read']);
        await fetchKeys();
      },
      { successMessage: 'API key created' },
    );
  }, [run, newKeyName, selectedScopes, fetchKeys]);

  const handleRevoke = useCallback(
    async (id: string) => {
      await run(
        async () => {
          await api.delete(`/admin/api-keys/${id}`);
          setKeys((curr) => curr.filter((k) => k.id !== id));
          setRevokeId(null);
        },
        { successMessage: 'API key revoked' },
      );
    },
    [run],
  );

  const handleCopy = useCallback(async () => {
    if (!createdKey) return;
    const ok = await copyToClipboard(createdKey);
    if (ok) {
      setCopied(true);
      success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  }, [createdKey, success]);

  const toggleScope = (scope: ApiKeyScope) => {
    setSelectedScopes((curr) =>
      curr.includes(scope) ? curr.filter((s) => s !== scope) : [...curr, scope],
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="API Keys"
        icon={<KeyRound className="h-5 w-5" />}
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setCreatedKey(null);
                setCreateOpen(true);
              }}
              className="panel-btn-primary gap-1.5 text-sm"
            >
              <Plus className="h-4 w-4" /> Create key
            </button>
            <button
              type="button"
              onClick={() => void fetchKeys()}
              disabled={loading}
              className="panel-btn-ghost gap-1.5 text-xs"
            >
              {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
          </>
        }
      />

      {loading && keys.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <PremiumLoader label="Loading API keys…" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <p className="text-sm text-red-300">{loadError}</p>
          <button type="button" onClick={() => void fetchKeys()} className="panel-btn-primary text-xs">
            Retry
          </button>
        </div>
      ) : keys.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card flex flex-col items-center justify-center gap-4 py-20 text-center"
        >
          <KeyRound className="h-12 w-12 text-zinc-600" />
          <p className="text-zinc-400">No API keys yet</p>
          <button
            type="button"
            onClick={() => {
              setCreatedKey(null);
              setCreateOpen(true);
            }}
            className="panel-btn-primary text-xs"
          >
            Create your first key
          </button>
        </motion.div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {keys.map((key, index) => (
              <motion.div
                key={key.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="panel-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">{key.name}</h3>
                    <p className="mt-1 font-mono text-xs text-zinc-400">
                      {key.keyPrefix}…
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setRevokeId(key.id)}
                      className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-red-500/10 hover:text-red-400"
                      aria-label={`Revoke ${key.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {key.scopes.map((scope) => (
                    <span
                      key={scope}
                      className={cn(
                        'rounded-md border px-2 py-0.5 text-[10px] font-medium',
                        SCOPE_BADGE_TONE[scope] ?? 'border-white/10 bg-white/5 text-zinc-400',
                      )}
                    >
                      {SCOPE_LABELS[scope] ?? scope}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                  <span>Created {timeAgo(key.createdAt)}</span>
                  {key.lastUsedAt && <span>Used {timeAgo(key.lastUsedAt)}</span>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreatedKey(null);
        }}
        title="Create API key"
        icon={<Plus className="h-4 w-4" />}
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="panel-btn-ghost"
              onClick={() => {
                setCreateOpen(false);
                setCreatedKey(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="panel-btn-primary"
              onClick={() => void handleCreate()}
              disabled={busy || !newKeyName.trim() || selectedScopes.length === 0}
            >
              {busy && <Spinner />} Create
            </button>
          </>
        }
      >
        {createdKey ? (
          <div className="space-y-4">
            <p className="text-sm text-amber-300">
              Copy this key now — it is stored hashed and cannot be retrieved again.
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <code className="flex-1 break-all font-mono text-sm text-amber-100">{createdKey}</code>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 transition hover:bg-white/10"
                aria-label="Copy key"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="panel-label" htmlFor="api-key-name">Name</label>
              <input
                id="api-key-name"
                className="panel-input"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. CI pipeline"
              />
            </div>
            <div>
              <label className="panel-label">Scopes</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SCOPE_OPTIONS.map((scope) => {
                  const checked = selectedScopes.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => toggleScope(scope)}
                      className={cn(
                        'flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition',
                        checked
                          ? 'border-theme-500/50 bg-theme-500/20 text-theme-100'
                          : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-md border',
                          checked ? 'border-theme-500 bg-theme-500' : 'border-white/20 bg-transparent',
                        )}
                      >
                        {checked && <Check className="h-3 w-3 text-white" />}
                      </span>
                      {SCOPE_LABELS[scope]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(revokeId)}
        onClose={() => setRevokeId(null)}
        onConfirm={() => revokeId && void handleRevoke(revokeId)}
        title="Revoke API key"
        message="This will immediately invalidate the key. Any service using it will lose access."
        confirmLabel="Revoke"
        danger
        busy={busy}
      />
    </div>
  );
}
