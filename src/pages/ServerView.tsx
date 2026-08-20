import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Terminal,
  FolderOpen,
  Users,
  Puzzle,
  Package,
  HardDrive,
  Globe,
  Settings2,
  UserCog,
  FileKey,
  Radio,
  SlidersHorizontal,
  Play,
  Square,
  RotateCw,
  Trash2,
  Copy,
  Cpu,
  MemoryStick,
  Disc3,
  Clock,
  Network,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { getSocket } from '@/lib/socket';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner, LoadingOverlay } from '@/components/Loaders';
import { StatCard, UsageBar } from '@/components/StatCard';
import {
  cn,
  serverAddress,
  formatBytes,
  formatUptime,
  timeAgo,
  STATUS_STYLES,
  softwareLabel,
  copyToClipboard,
} from '@/lib/format';
import type { GameServerView, ServerStats, PlayitTunnel, ServerStatus } from '@/types';

import { ServerConsole } from '@/components/ServerConsole';
import { FileManager } from '@/components/FileManager';
import { PlayerManager } from '@/components/PlayerManager';
import { PluginManager } from '@/components/PluginManager';
import { ModManager } from '@/components/ModManager';
import { ServerBackups } from '@/components/ServerBackups';
import { WorldManager } from '@/components/WorldManager';
import { ServerProperties } from '@/components/ServerProperties';
import { SubUsersManager } from '@/components/SubUsersManager';
import { ServerSFTP } from '@/components/ServerSFTP';
import { ServerSettings } from '@/components/ServerSettings';

interface TabDef {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'console', label: 'Console', icon: Terminal },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'players', label: 'Players', icon: Users },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'mods', label: 'Mods', icon: Package },
  { id: 'backups', label: 'Backups', icon: HardDrive },
  { id: 'world', label: 'World', icon: Globe },
  { id: 'properties', label: 'Properties', icon: Settings2 },
  { id: 'subusers', label: 'Sub-users', icon: UserCog },
  { id: 'sftp', label: 'SFTP', icon: FileKey },
  { id: 'playit', label: 'Playit', icon: Radio },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

export default function ServerView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { success, error: toastError } = useToast();
  const { run } = useAsyncAction();

  const [server, setServer] = useState<GameServerView | null>(null);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get<{ server: GameServerView }>(`/servers/${id}`);
      setServer(data.server);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load server'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const refreshStats = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get<ServerStats>(`/servers/${id}/stats`);
      setStats(data);
    } catch {
      /* stats are best-effort */
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshStats();
    const timer = setInterval(() => {
      void refreshStats();
    }, 3000);
    return () => clearInterval(timer);
  }, [refreshStats]);

  // Live per-server usage pushed over Socket.IO. Joining the room at the page
  // level (not just the console tab) keeps stats + status live on every tab.
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    socket.emit('joinServer', id);

    const onStats = (payload: ServerStats & { serverId: string }) => {
      if (payload.serverId === id) setStats(payload);
    };
    const onStatus = (payload: { serverId: string; status: ServerStatus }) => {
      if (payload.serverId === id) {
        setServer((curr) => (curr ? { ...curr, status: payload.status } : curr));
      }
    };

    socket.on('serverStats', onStats);
    socket.on('status', onStatus);

    return () => {
      socket.off('serverStats', onStats);
      socket.off('status', onStatus);
      socket.emit('leaveServer', id);
    };
  }, [id]);

  const handlePower = async (action: 'start' | 'stop' | 'restart') => {
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/servers/${id}/${action}`);
      success(`Server ${action}ing…`);
      await refresh();
    } catch (err) {
      toastError('Action failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await api.delete(`/servers/${id}`);
      success('Server deleted');
      navigate('/servers');
    } catch (err) {
      toastError('Failed to delete server', errorMessage(err));
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <PremiumLoader label="Loading server" />
      </div>
    );
  }

  if (loadError || !server) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-red-400" />
        <p className="mt-3 text-sm text-red-300">{loadError ?? 'Server not found'}</p>
        <button
          type="button"
          onClick={() => navigate('/servers')}
          className="panel-btn-ghost mt-4 text-xs py-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back to servers
        </button>
      </div>
    );
  }

  const status = STATUS_STYLES[server.status];
  const canManage = isAdmin || server.owner === server.owner;

  return (
    <div className="space-y-6">
      <LoadingOverlay show={busy} title="Working…" />

      {/* Header */}
      <div className="panel-card relative overflow-hidden p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-2xl font-bold text-white">{server.name}</h1>
              <span className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', status.bg, status.text)}>
                <span className={cn('h-2 w-2 rounded-full', status.dot)} />
                {status.label}
              </span>
              {server.suspended && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                  Suspended
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              {softwareLabel(server.serverType)} · {server.version} · {server.runtimeType}
            </p>
            <button
              type="button"
              onClick={() => void copyToClipboard(serverAddress(server))}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-theme-500/40 hover:text-theme-300"
            >
              <Network className="h-3.5 w-3.5" />
              {serverAddress(server)}
              <Copy className="h-3 w-3 opacity-60" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!server.isRunning ? (
              <button type="button" disabled={busy} onClick={() => void handlePower('start')} className="panel-btn-primary text-xs py-2">
                {busy ? <Spinner /> : <Play className="h-4 w-4" />} Start
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => void handlePower('restart')} className="panel-btn-ghost text-xs py-2">
                  {busy ? <Spinner /> : <RotateCw className="h-4 w-4" />} Restart
                </button>
                <button type="button" disabled={busy} onClick={() => void handlePower('stop')} className="panel-btn-danger text-xs py-2">
                  {busy ? <Spinner /> : <Square className="h-4 w-4" />} Stop
                </button>
              </>
            )}
            {(isAdmin || canManage) && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:border-red-500/30 hover:text-red-300"
                aria-label="Delete server"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto scrollbar-none border-b border-white/10 pb-px">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition',
                active
                  ? 'border-theme-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === 'overview' && (
          <OverviewTab server={server} stats={stats} onPower={handlePower} busy={busy} />
        )}
        {activeTab === 'console' && <ServerConsole server={server} onRefresh={refresh} />}
        {activeTab === 'files' && <FileManager server={server} onRefresh={refresh} />}
        {activeTab === 'players' && <PlayerManager server={server} onRefresh={refresh} />}
        {activeTab === 'plugins' && <PluginManager server={server} onRefresh={refresh} />}
        {activeTab === 'mods' && <ModManager server={server} onRefresh={refresh} />}
        {activeTab === 'backups' && <ServerBackups server={server} onRefresh={refresh} />}
        {activeTab === 'world' && <WorldManager server={server} onRefresh={refresh} />}
        {activeTab === 'properties' && <ServerProperties server={server} onRefresh={refresh} />}
        {activeTab === 'subusers' && <SubUsersManager server={server} onRefresh={refresh} />}
        {activeTab === 'sftp' && <ServerSFTP server={server} onRefresh={refresh} />}
        {activeTab === 'playit' && <PlayitTab server={server} onRefresh={refresh} />}
        {activeTab === 'settings' && <ServerSettings server={server} onRefresh={refresh} />}
      </motion.div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete server"
        message={
          <span>
            Permanently delete <strong>{server.name}</strong>? This also removes its files and
            cannot be undone.
          </span>
        }
        confirmLabel="Delete server"
        danger
        busy={deleting}
        requireText={server.name}
      />
    </div>
  );
}

function OverviewTab({
  server,
  stats,
  onPower,
  busy,
}: {
  server: GameServerView;
  stats: ServerStats | null;
  onPower: (action: 'start' | 'stop' | 'restart') => void;
  busy: boolean;
}) {
  const cards = [
    {
      label: 'Memory',
      value: stats ? `${(stats.ram / 1024).toFixed(2)}` : `${server.ram}`,
      unit: 'GB',
      icon: <MemoryStick className="h-4 w-4" />,
      footer: stats ? `${stats.ram} MB / ${stats.ramLimit} MB` : `Allocated ${server.ram} GB`,
      accent: 'theme' as const,
    },
    {
      label: 'CPU',
      value: stats ? Math.round(stats.cpu) : 0,
      unit: '%',
      icon: <Cpu className="h-4 w-4" />,
      footer: stats ? `${Math.round(stats.cpu)}% used` : 'Live usage',
      accent: 'sky' as const,
    },
    {
      label: 'Disk',
      value: stats ? stats.disk.toFixed(2) : '—',
      unit: stats ? 'GB' : '',
      icon: <Disc3 className="h-4 w-4" />,
      footer: 'World + files',
      accent: 'emerald' as const,
    },
    {
      label: 'Uptime',
      value: stats ? formatUptime(stats.uptime) : '—',
      icon: <Clock className="h-4 w-4" />,
      footer: server.isRunning ? 'Running' : 'Stopped',
      accent: 'amber' as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            unit={card.unit}
            icon={card.icon}
            footer={card.footer}
            accent={card.accent}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="panel-card p-4 lg:col-span-2">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Resource allocation
          </p>
          <div className="space-y-4">
            <UsageBar label="Allocated RAM" used={server.ram} total={server.ram} unit=" GB" formatValue={() => `${server.ram} GB`} />
            <UsageBar label="Allocated CPU" used={server.cpu} total={server.cpu} unit="%" formatValue={() => `${server.cpu}%`} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {!server.isRunning ? (
              <button type="button" disabled={busy} onClick={() => void onPower('start')} className="panel-btn-primary text-xs py-2">
                <Play className="h-4 w-4" /> Start server
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => void onPower('restart')} className="panel-btn-ghost text-xs py-2">
                  <RotateCw className="h-4 w-4" /> Restart
                </button>
                <button type="button" disabled={busy} onClick={() => void onPower('stop')} className="panel-btn-danger text-xs py-2">
                  <Square className="h-4 w-4" /> Stop
                </button>
              </>
            )}
          </div>
        </div>

        <div className="panel-card space-y-3 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Connection</p>
          <div>
            <p className="text-xs text-zinc-500">Address</p>
            <p className="truncate text-sm text-zinc-200">{serverAddress(server)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Port</p>
            <p className="text-sm text-zinc-200">{server.port}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Runtime</p>
            <p className="text-sm text-zinc-200">{server.runtimeType}</p>
          </div>
          {server.playitTunnel?.publicAddress && (
            <div>
              <p className="text-xs text-zinc-500">Playit tunnel</p>
              <p className="flex items-center gap-1 text-sm text-theme-300">
                <ExternalLink className="h-3.5 w-3.5" />
                {server.playitTunnel.publicAddress}
              </p>
            </div>
          )}
          <p className="pt-1 text-xs text-zinc-600">Created {timeAgo(server.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}

function PlayitTab({
  server,
  onRefresh,
}: {
  server: GameServerView;
  onRefresh: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [tunnel, setTunnel] = useState<PlayitTunnel | null>(null);
  const [running, setRunning] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ enabled: boolean; running: boolean; tunnel: PlayitTunnel }>(
        `/servers/${server.id}/playit`,
      );
      setEnabled(data.enabled);
      setRunning(data.running);
      setTunnel(data.tunnel);
      setAddress(data.tunnel?.publicAddress ?? '');
    } catch (err) {
      toastError('Failed to load playit status', errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <PremiumLoader label="Loading playit" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Radio className="h-10 w-10 text-zinc-700" />
        <p className="mt-3 text-sm text-zinc-500">
          playit.gg tunneling is disabled by the administrator.
        </p>
      </div>
    );
  }

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      success(msg);
      await load();
      onRefresh();
    } catch (err) {
      toastError('Action failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel-card space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">playit.gg tunnel</h3>
            <p className="text-xs text-zinc-500">
              {running ? 'Connected — players can join via the address below.' : 'Tunnel not active.'}
            </p>
          </div>
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-medium',
              running
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
            )}
          >
            {running ? 'Active' : 'Inactive'}
          </span>
        </div>

        {tunnel?.agentClaimUrl && (
          <a
            href={tunnel.agentClaimUrl}
            target="_blank"
            rel="noreferrer"
            className="panel-btn-ghost inline-flex text-xs py-2"
          >
            <ExternalLink className="h-4 w-4" /> Claim agent
          </a>
        )}

        <div>
          <label className="panel-label">Public address (optional)</label>
          <div className="flex gap-2">
            <input
              className="panel-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="playit-id.playit.gg"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => api.put(`/servers/${server.id}/playit`, { publicAddress: address }), 'Address saved')}
              className="panel-btn-primary text-xs py-2"
            >
              Save
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!running ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => api.post(`/servers/${server.id}/playit`), 'Tunnel starting')}
              className="panel-btn-primary text-xs py-2"
            >
              {busy ? <Spinner /> : <Radio className="h-4 w-4" />} Start tunnel
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => api.delete(`/servers/${server.id}/playit`), 'Tunnel stopped')}
              className="panel-btn-danger text-xs py-2"
            >
              Stop tunnel
            </button>
          )}
        </div>

        {tunnel?.publicAddress && (
          <p className="text-sm text-theme-300">{tunnel.publicAddress}</p>
        )}
      </div>
    </div>
  );
}
