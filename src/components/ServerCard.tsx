import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreVertical, Play, StopCircle, RefreshCw, Copy, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAsyncAction, useToast } from '@/context/ToastContext';
import { STATUS_STYLES, softwareLabel, serverAddress, copyToClipboard, cn } from '@/lib/format';
import { Spinner } from '@/components/Loaders';
import type { GameServerView } from '@/types';

export function ServerCard({ server, onOpen, onRefresh }: { server: GameServerView; onOpen?: (id: string) => void; onRefresh?: () => void }) {
  const navigate = useNavigate();
  const { run, busy } = useAsyncAction();
  const { success } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setMenuOpen(false);
    onOpen?.(server.id);
    navigate(`/servers/${server.id}`);
  }, [server.id, onOpen, navigate]);

  const handlePower = useCallback(
    async (action: 'start' | 'stop' | 'restart') => {
      setMenuOpen(false);
      await run(
        async () => {
          const { data } = await api.post(`/servers/${server.id}/${action}`, {});
          return data;
        },
        {
          successMessage: `${action.charAt(0).toUpperCase() + action.slice(1)}ing server`,
        },
      );
      onRefresh?.();
    },
    [server.id, run, onRefresh],
  );

  const handleCopy = useCallback(async () => {
    setMenuOpen(false);
    const address = serverAddress(server);
    const ok = await copyToClipboard(address);
    if (ok) {
      success('Address copied', address);
    }
  }, [server, success]);

  const statusStyle = STATUS_STYLES[server.status] ?? STATUS_STYLES.offline;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="panel-card group relative cursor-pointer overflow-hidden rounded-2xl p-5 transition hover:border-white/20"
      onClick={handleOpen}
    >
      {server.suspended && (
        <div className="absolute right-3 top-3 z-10 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
          Suspended
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
            <span className={cn('h-2 w-2 rounded-full', statusStyle.dot)} />
            <span className={cn('text-xs font-medium', statusStyle.text)}>{statusStyle.label}</span>
          </span>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={cn(
              'rounded-lg p-1.5 transition',
              menuOpen ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white hover:bg-white/10',
            )}
            aria-label="Server menu"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/98 shadow-2xl backdrop-blur-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={handleOpen}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/5"
                >
                  <ExternalLink className="h-4 w-4" /> Open
                </button>
                <button
                  type="button"
                  onClick={() => handlePower('start')}
                  disabled={server.isRunning || busy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />} Start
                </button>
                <button
                  type="button"
                  onClick={() => handlePower('stop')}
                  disabled={!server.isRunning || busy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-amber-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Spinner className="h-4 w-4" /> : <StopCircle className="h-4 w-4" />} Stop
                </button>
                <button
                  type="button"
                  onClick={() => handlePower('restart')}
                  disabled={!server.isRunning || busy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sky-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />} Restart
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/5"
                >
                  <Copy className="h-4 w-4" /> Copy address
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="truncate text-lg font-semibold text-white">{server.name}</h3>
        <p className="mt-0.5 text-sm text-zinc-400">
          {softwareLabel(server.serverType)} {server.version}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          className="flex items-center gap-1 transition hover:text-theme-400"
        >
          <span className="font-mono">{serverAddress(server)}</span>
          <Copy className="h-3 w-3" />
        </button>
        <span className="font-mono">:{server.port}</span>
        <span>{server.ram} GB</span>
        <span>{server.cpu}%</span>
        <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono uppercase text-zinc-300">
          {server.runtimeType}
        </span>
      </div>
    </motion.div>
  );
}
