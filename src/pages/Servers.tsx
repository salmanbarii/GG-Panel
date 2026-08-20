import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { CreateServerWizard } from '@/components/CreateServerWizard';
import { ServerCard } from '@/components/ServerCard';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';
import type { GameServerView } from '@/types';

export default function ServersPage() {
  const navigate = useNavigate();
  const { error: showError } = useToast();

  const [servers, setServers] = useState<GameServerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<{ servers: GameServerView[] }>('/servers');
      setServers(data.servers);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load servers'));
      showError('Failed to load servers', errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (!query.trim()) return servers;
    const q = query.trim().toLowerCase();
    return servers.filter((s) => s.name.toLowerCase().includes(q));
  }, [servers, query]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Servers"
        description="Manage your Minecraft servers"
        actions={
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="panel-btn-primary gap-1.5 text-sm"
          >
            <Plus className="h-4 w-4" /> New server
          </button>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers..."
            className="panel-input pl-9 sm:w-64"
          />
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="panel-btn-ghost gap-1.5 text-xs"
        >
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>

      {loading && servers.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <PremiumLoader label="Loading servers" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <p className="text-sm text-red-300">{loadError}</p>
          <button type="button" onClick={reload} className="panel-btn-primary text-xs">
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <p className="text-sm text-zinc-500">
            {query ? 'No servers match your search.' : 'No servers yet.'}
          </p>
          {!query && (
            <button type="button" onClick={() => setWizardOpen(true)} className="panel-btn-primary text-xs">
              <Plus className="h-4 w-4" /> Create your first server
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((server, index) => (
            <motion.div
              key={server.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
            >
              <ServerCard
                server={server}
                onOpen={(id) => navigate(`/servers/${id}`)}
                onRefresh={reload}
              />
            </motion.div>
          ))}
        </div>
      )}

      <CreateServerWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(s) => {
          setServers((curr) => [...curr, s]);
          setWizardOpen(false);
        }}
      />
    </div>
  );
}
