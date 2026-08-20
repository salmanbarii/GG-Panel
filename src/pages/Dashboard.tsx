import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Server, Activity, Cpu, HardDrive, Plus } from 'lucide-react';
import { AmbientBackground } from '@/components/GlobalBackground';
import { PremiumLoader } from '@/components/Loaders';
import { StatCard } from '@/components/StatCard';
import { ServerCard } from '@/components/ServerCard';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import type { GameServerView, SystemStats } from '@/types';

interface Totals {
  totalServers: number;
  runningServers: number;
  totalRamGb: number;
  totalCpuPercent: number;
  suspended: number;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();
  const { error: showError } = useToast();

  const [totals, setTotals] = useState<Totals | null>(null);
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [servers, setServers] = useState<GameServerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [totalsRes, systemRes, serversRes] = await Promise.all([
        api.get<Totals>('/servers/totals'),
        api.get<SystemStats>('/system/stats'),
        api.get<{ servers: GameServerView[] }>('/servers'),
      ]);
      setTotals(totalsRes.data);
      setSystem(systemRes.data);
      setServers(serversRes.data.servers);
    } catch (err) {
      const msg = errorMessage(err, 'Failed to load dashboard');
      setFetchError(msg);
      showError('Load failed', msg);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="relative min-h-screen">
      <div className="absolute inset-0 -z-0">
        <AmbientBackground />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl font-bold text-white"
            >
              Welcome back, {user?.username}
            </motion.h1>
            <p className="mt-1 text-sm text-zinc-400">{today}</p>
          </div>
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            className="panel-btn-primary"
            onClick={() => navigate('/servers/new')}
            aria-label="Create new server"
          >
            <Plus className="h-4 w-4" />
            New server
          </motion.button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <PremiumLoader label="Loading dashboard…" />
          </div>
        )}

        {fetchError && !loading && (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <p className="text-sm text-red-400">{fetchError}</p>
            <button type="button" className="panel-btn-primary" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}

        {!loading && !fetchError && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Total servers"
                value={totals?.totalServers ?? 0}
                icon={<Server className="h-4 w-4" />}
                footer={`${totals?.suspended ?? 0} suspended`}
              />
              <StatCard
                label="Online"
                value={totals?.runningServers ?? 0}
                unit={`/ ${totals?.totalServers ?? 0}`}
                icon={<Activity className="h-4 w-4" />}
                accent="emerald"
              />
              <StatCard
                label="Total RAM"
                value={totals?.totalRamGb ?? 0}
                unit="GB"
                icon={<HardDrive className="h-4 w-4" />}
                accent="sky"
              />
              <StatCard
                label="CPU usage"
                value={system ? `${system.cpuPercent.toFixed(1)}%` : '—'}
                icon={<Cpu className="h-4 w-4" />}
                footer={system?.panelVersion ?? system?.hostname}
              />
            </div>

            <div className="mt-8">
              <h2 className="mb-4 text-lg font-semibold text-white">Servers</h2>
              {servers.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="panel-card flex flex-col items-center justify-center gap-4 py-16 text-center"
                >
                  <Server className="h-12 w-12 text-zinc-600" />
                  <p className="text-zinc-400">No servers yet</p>
                  <Link to="/servers/new" className="panel-btn-primary">
                    <Plus className="h-4 w-4" />
                    Create your first server
                  </Link>
                </motion.div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {servers.map((server) => (
                    <ServerCard
                      key={server.id}
                      server={server}
                      onOpen={(id) => navigate(`/servers/${id}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
