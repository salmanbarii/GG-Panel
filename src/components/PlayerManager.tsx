import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Shield,
  Ban,
  Undo2,
  UserPlus,
  UserMinus,
  MessageSquare,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { cn } from '@/lib/format';
import type { GameServerView } from '@/types';

interface PlayerManagerProps {
  server: GameServerView;
  onRefresh?: () => void;
}

interface PlayersResponse {
  isRunning: boolean;
  players: { name: string; online: boolean; joinedAt?: string; isOp?: boolean; isBanned?: boolean }[];
  ops?: string[];
  banned?: string[];
  whitelist?: string[];
}

type PlayerAction = 'op' | 'deop' | 'kick' | 'ban' | 'pardon' | 'whitelistAdd' | 'whitelistRemove';

const ACTION_LABELS: Record<PlayerAction, string> = {
  op: 'OP',
  deop: 'De-OP',
  kick: 'Kick',
  ban: 'Ban',
  pardon: 'Pardon',
  whitelistAdd: 'Whitelist',
  whitelistRemove: 'Unwhitelist',
};

export function PlayerManager({ server, onRefresh }: PlayerManagerProps) {
  const { success, error } = useToast();
  const { run } = useAsyncAction();

  const [data, setData] = useState<PlayersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{ action: PlayerAction; name: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionRequireConfirm, setActionRequireConfirm] = useState(false);

  const fetchPlayers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<PlayersResponse>(`/servers/${server.id}/players`);
      setData(data);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load players'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlayers();
  }, [server.id]);

  const handleAction = async () => {
    if (!actionTarget) return;
    setActionBusy(true);
    try {
      await api.post(`/servers/${server.id}/players/${actionTarget.action}`, { name: actionTarget.name });
      success(`${ACTION_LABELS[actionTarget.action]} ${actionTarget.name}`);
      setActionTarget(null);
      fetchPlayers();
      onRefresh?.();
    } catch (err) {
      error('Action failed', errorMessage(err));
    } finally {
      setActionBusy(false);
      setActionRequireConfirm(false);
    }
  };

  const requestAction = (action: PlayerAction, name: string) => {
    if (action === 'ban' || action === 'kick') {
      setActionTarget({ action, name });
      setActionRequireConfirm(true);
    } else {
      setActionTarget({ action, name });
      setActionRequireConfirm(false);
      void handleAction();
    }
  };

  const onlinePlayers = useMemo(
    () => data?.players.filter((p) => p.online) ?? [],
    [data],
  );
  const ops = useMemo(() => data?.ops ?? [], [data]);
  const banned = useMemo(() => data?.banned ?? [], [data]);
  const whitelisted = useMemo(() => data?.whitelist ?? [], [data]);

  const opSet = useMemo(() => new Set(ops.map((o) => o.toLowerCase())), [ops]);
  const bannedSet = useMemo(() => new Set(banned.map((b) => b.toLowerCase())), [banned]);
  const whitelistSet = useMemo(() => new Set(whitelisted.map((w) => w.toLowerCase())), [whitelisted]);

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm text-red-200">{loadError}</p>
          <button type="button" onClick={fetchPlayers} className="panel-btn-ghost text-xs py-1.5">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <PremiumLoader label="Loading players" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Players</h3>
          <p className="text-xs text-zinc-500">
            {onlinePlayers.length} online · {ops.length} ops · {banned.length} banned · {whitelisted.length} whitelisted
          </p>
        </div>
        <button
          type="button"
          onClick={fetchPlayers}
          className="panel-btn-ghost gap-1.5 text-xs py-2"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <p className="text-xs text-zinc-500">Lists reflect the last fetch from the server.</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Online</h4>
          {onlinePlayers.length === 0 ? (
            <p className="text-xs text-zinc-600">No players online.</p>
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence>
                {onlinePlayers.map((player) => (
                  <motion.div
                    key={player.name}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <User className="h-3.5 w-3.5 text-theme-400" />
                    <span className="flex-1 truncate text-sm text-zinc-200">{player.name}</span>
                    <div className="flex items-center gap-1">
                      {!opSet.has(player.name.toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => requestAction('op', player.name)}
                          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-theme-400"
                          aria-label="OP player"
                        >
                          <Shield className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {opSet.has(player.name.toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => requestAction('deop', player.name)}
                          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-red-300"
                          aria-label="De-OP player"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => requestAction('kick', player.name)}
                        className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-amber-300"
                        aria-label="Kick player"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                      {!bannedSet.has(player.name.toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => requestAction('ban', player.name)}
                          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-red-300"
                          aria-label="Ban player"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Operators</h4>
            {ops.length === 0 ? (
              <p className="text-xs text-zinc-600">No operators.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ops.map((name) => (
                  <span
                    key={name}
                    className="flex items-center gap-1 rounded-lg border border-theme-500/30 bg-theme-500/10 px-2 py-1 text-xs text-theme-300"
                  >
                    <Shield className="h-3 w-3" />
                    {name}
                    <button
                      type="button"
                      onClick={() => requestAction('deop', name)}
                      className="rounded p-0.5 text-zinc-500 transition hover:bg-white/10 hover:text-red-300"
                      aria-label={`De-OP ${name}`}
                    >
                      <UserMinus className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Banned</h4>
            {banned.length === 0 ? (
              <p className="text-xs text-zinc-600">No banned players.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {banned.map((name) => (
                  <span
                    key={name}
                    className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"
                  >
                    <Ban className="h-3 w-3" />
                    {name}
                    <button
                      type="button"
                      onClick={() => requestAction('pardon', name)}
                      className="rounded p-0.5 text-zinc-500 transition hover:bg-white/10 hover:text-emerald-300"
                      aria-label={`Pardon ${name}`}
                    >
                      <Undo2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Whitelisted</h4>
            {whitelisted.length === 0 ? (
              <p className="text-xs text-zinc-600">Whitelist empty.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {whitelisted.map((name) => (
                  <span
                    key={name}
                    className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-sky-300"
                  >
                    <UserPlus className="h-3 w-3" />
                    {name}
                    <button
                      type="button"
                      onClick={() => requestAction('whitelistRemove', name)}
                      className="rounded p-0.5 text-zinc-500 transition hover:bg-white/10 hover:text-red-300"
                      aria-label={`Unwhitelist ${name}`}
                    >
                      <UserMinus className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!actionTarget && actionRequireConfirm}
        onClose={() => { setActionTarget(null); setActionRequireConfirm(false); }}
        onConfirm={handleAction}
        title={actionTarget ? `${ACTION_LABELS[actionTarget.action]} ${actionTarget.name}` : ''}
        message={
          <span>
            {actionTarget?.action === 'ban' && (
              <>This will permanently ban <strong>{actionTarget?.name}</strong> from the server.</>
            )}
            {actionTarget?.action === 'kick' && (
              <>Kick <strong>{actionTarget?.name}</strong> from the server?</>
            )}
          </span>
        }
        confirmLabel={actionTarget ? ACTION_LABELS[actionTarget.action] : 'Confirm'}
        danger
        busy={actionBusy}
      />
    </div>
  );
}
