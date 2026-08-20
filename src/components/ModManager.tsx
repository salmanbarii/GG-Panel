import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  PackageOpen,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { cn, formatBytes, timeAgo } from '@/lib/format';
import type { GameServerView, InstalledAddon, ModrinthProject } from '@/types';

interface ModManagerProps {
  server: GameServerView;
  onRefresh?: () => void;
}

interface InstalledResponse {
  installed: InstalledAddon[];
  kind: 'plugin' | 'mod';
}

interface SearchResponse {
  hits: ModrinthProject[];
  total: number;
}

export function ModManager({ server, onRefresh }: ModManagerProps) {
  const { success, error } = useToast();
  const { run, busy } = useAsyncAction();

  const [installed, setInstalled] = useState<InstalledAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModrinthProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const fetchInstalled = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<InstalledResponse>(`/servers/${server.id}/mods`);
      setInstalled(data.installed);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load mods'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstalled();
  }, [server.id]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query.trim()) {
        setSearchResults([]);
        setSearchTotal(0);
        return;
      }
      setSearching(true);
      try {
        const { data } = await api.get<SearchResponse>(`/servers/${server.id}/mods/search`, {
          params: { query, version: server.version },
        });
        setSearchResults(data.hits);
        setSearchTotal(data.total);
      } catch (err) {
        error('Search failed', errorMessage(err));
        setSearchResults([]);
        setSearchTotal(0);
      } finally {
        setSearching(false);
      }
    },
    [server.id, server.version, error],
  );

  const debouncedSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => handleSearch(query), 400);
    },
    [handleSearch],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleInstall = async (project: ModrinthProject) => {
    setInstalling(project.project_id);
    try {
      await api.post(`/servers/${server.id}/mods`, { projectId: project.project_id });
      success('Mod installed', 'Restart the server to load it.');
      fetchInstalled();
      onRefresh?.();
    } catch (err) {
      error('Install failed', errorMessage(err));
    } finally {
      setInstalling(null);
    }
  };

  const handleToggle = async (filename: string) => {
    setToggling(filename);
    try {
      const { data } = await api.post<{ addon: InstalledAddon }>(
        `/servers/${server.id}/mods/${encodeURIComponent(filename)}/toggle`,
      );
      setInstalled((prev) =>
        prev.map((a) => (a.filename === filename ? data.addon : a)),
      );
      success('Mod toggled');
    } catch (err) {
      error('Toggle failed', errorMessage(err));
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/servers/${server.id}/mods/${encodeURIComponent(deleteTarget)}`);
      success('Mod removed');
      setDeleteTarget(null);
      fetchInstalled();
      onRefresh?.();
    } catch (err) {
      error('Remove failed', errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm text-red-200">{loadError}</p>
          <button type="button" onClick={fetchInstalled} className="panel-btn-ghost text-xs py-1.5">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <PremiumLoader label="Loading mods" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Mods</h3>
          <p className="text-xs text-zinc-500">
            {installed.length} installed · {formatBytes(installed.reduce((s, a) => s + a.size, 0))} total
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSearch((v) => !v)}
          className="panel-btn-primary gap-1.5 text-xs py-2"
        >
          {showSearch ? <RefreshCw className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showSearch ? 'Close search' : 'Install from Modrinth'}
        </button>
      </div>

      {showSearch && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search Modrinth mods…"
              value={searchQuery}
              onChange={(e) => debouncedSearch(e.target.value)}
              className="panel-input pl-9"
            />
          </div>
          {searching && (
            <div className="flex items-center justify-center p-6">
              <Spinner className="h-5 w-5 text-theme-400" />
            </div>
          )}
          {!searching && searchResults.length === 0 && searchQuery && (
            <p className="text-center text-xs text-zinc-500">No mods found.</p>
          )}
          {searchTotal > 0 && (
            <p className="text-xs text-zinc-500">{searchTotal} result{searchTotal !== 1 ? 's' : ''}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AnimatePresence>
              {searchResults.map((project) => (
                <motion.div
                  key={project.project_id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="panel-card flex items-start gap-3 p-3"
                >
                  {project.icon_url && (
                    <img
                      src={project.icon_url}
                      alt=""
                      className="h-10 w-10 rounded-lg border border-white/10 bg-black/40 object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-200">{project.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{project.description}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-600">
                      <span>{project.downloads.toLocaleString()} downloads</span>
                      {project.author && <span>by {project.author}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleInstall(project)}
                    disabled={installing === project.project_id}
                    className="panel-btn-primary shrink-0 gap-1.5 text-xs py-1.5"
                  >
                    {installing === project.project_id && <Spinner />}
                    Install
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {installed.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <PackageOpen className="h-10 w-10 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">No mods installed.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {installed.map((addon) => (
              <motion.div
                key={addon.filename}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="panel-card flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-200">{addon.filename}</p>
                  <p className="text-xs text-zinc-500">
                    {formatBytes(addon.size)} · modified {timeAgo(addon.modifiedAt)}
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-xs font-medium',
                    addon.enabled
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
                  )}
                >
                  {addon.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleToggle(addon.filename)}
                    disabled={toggling === addon.filename}
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                    aria-label={addon.enabled ? 'Disable mod' : 'Enable mod'}
                  >
                    {toggling === addon.filename ? (
                      <Spinner className="h-4 w-4" />
                    ) : addon.enabled ? (
                      <ToggleRight className="h-4 w-4 text-theme-400" />
                    ) : (
                      <ToggleLeft className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(addon.filename)}
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-red-300"
                    aria-label="Remove mod"
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
        title="Remove mod"
        message={
          <span>
            Permanently remove <strong>{deleteTarget}</strong>? This cannot be undone.
          </span>
        }
        confirmLabel="Remove"
        danger
        busy={deleteBusy}
      />
    </div>
  );
}
