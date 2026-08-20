import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { Modal } from '@/components/Modal';
import type { GameServerView } from '@/types';

const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/servers', label: 'Servers' },
  { to: '/nodes', label: 'Nodes' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/account', label: 'Account' },
];

const NAV_ICONS: Record<string, string> = {
  Dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  Servers: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2',
  Nodes: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  'API Keys': 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.878 6 6 0 01-6.5-3.5 6 6 0 01-6.257-5.378A6 6 0 0115 7z',
  Account: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
};

export function GlobalSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [servers, setServers] = useState<GameServerView[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQuery('');
    api.get<{ servers: GameServerView[] }>('/servers').then((res) => {
      if (!cancelled) setServers(res.data.servers);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q) {
      return NAV_LINKS.map((link) => ({ type: 'nav' as const, ...link }));
    }

    const matchedNav = NAV_LINKS.filter((link) => link.label.toLowerCase().includes(q));
    const matchedServers = servers
      .filter((s) => s.name.toLowerCase().includes(q))
      .map((s) => ({
        type: 'server' as const,
        to: `/servers/${s.id}`,
        label: s.name,
        server: s,
      }));

    return [...matchedNav.map((link) => ({ type: 'nav' as const, ...link })), ...matchedServers];
  }, [q, servers]);

  const handleSelect = useCallback(
    (to: string) => {
      onClose();
      navigate(to);
    },
    [navigate, onClose],
  );

  return (
    <Modal open={open} onClose={onClose} title="Search" description="Find servers and pages" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a server name or page…"
            className="panel-input pl-9"
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-xl border border-white/5 bg-black/20 scrollbar-none">
          {results.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500">No results found</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {results.map((item) => (
                <li key={item.to}>
                  <button
                    type="button"
                    onClick={() => handleSelect(item.to)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-200 transition hover:bg-white/5"
                  >
                    {item.type === 'server' ? (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-theme-500/30 bg-theme-500/10 text-theme-400">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <rect x="2" y="2" width="20" height="8" rx="2" />
                          <rect x="2" y="14" width="20" height="8" rx="2" />
                          <circle cx="6" cy="6" r="1" fill="currentColor" stroke="none" />
                          <circle cx="6" cy="18" r="1" fill="currentColor" stroke="none" />
                        </svg>
                      </span>
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d={NAV_ICONS[item.label] || ''} />
                        </svg>
                      </span>
                    )}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.type === 'server' && (
                      <span className="font-mono text-xs text-zinc-500">
                        {item.server?.connectAddress ?? item.server?.id}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-zinc-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
