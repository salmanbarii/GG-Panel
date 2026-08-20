import { useRef, useEffect, useState, useCallback, type KeyboardEvent } from 'react';
import { Terminal, X, Wifi, WifiOff } from 'lucide-react';
import { useServerSocket } from '@/hooks/useServerSocket';
import { STATUS_STYLES, stripAnsi, cn } from '@/lib/format';
import { Spinner } from '@/components/Loaders';
import type { GameServerView } from '@/types';

export function ServerConsole({ server, onRefresh }: { server: GameServerView; onRefresh?: () => void }) {
  const { lines, status, connected, error, sendCommand, clear } = useServerSocket(server.id);
  const [input, setInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 80) {
      setAutoScroll(false);
    } else if (distanceFromBottom < 40) {
      setAutoScroll(true);
    }
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleSend = useCallback(() => {
    const cmd = input.trim();
    if (!cmd || !connected) return;
    sendCommand(cmd);
    setInput('');
  }, [input, connected, sendCommand]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.offline;
  const isOffline = status === 'offline';
  const showPlaceholder = !connected && lines.length === 0;

  return (
    <div className="panel-card flex h-[28rem] max-h-[60vh] flex-col bg-black/60">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
            <span className={cn('h-2 w-2 rounded-full', statusStyle.dot)} />
            <span className={cn('text-xs font-medium', statusStyle.text)}>{statusStyle.label}</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            {connected ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-zinc-500" />}
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAutoScroll((v) => !v)}
            className={cn(
              'rounded-lg p-1.5 text-xs transition',
              autoScroll ? 'text-theme-400 bg-theme-500/10' : 'text-zinc-500 hover:text-white hover:bg-white/10',
            )}
            aria-label="Toggle auto-scroll"
            title="Auto-scroll"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-white"
            aria-label="Clear console"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-none flex-1 overflow-y-auto bg-black/40 p-3 font-mono text-xs leading-relaxed text-zinc-300"
      >
        {showPlaceholder ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
            <Terminal className="h-8 w-8 opacity-50" />
            <p className="text-sm">Console output will appear here</p>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words">
            {lines.map((line, i) => (
              <span key={i} className="block">{stripAnsi(line) || '\u00A0'}</span>
            ))}
          </pre>
        )}
      </div>

      {error && (
        <div className="border-t border-red-500/30 bg-red-500/5 px-4 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-white/10 bg-black/30 px-3 py-2.5">
        <span className="text-theme-400 select-none font-mono text-sm">&gt;</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!connected || isOffline}
          placeholder={!connected ? 'Not connected...' : 'Type a command...'}
          className="panel-input flex-1 bg-transparent font-mono text-xs focus:border-theme-500/60 focus:ring-theme-500/20"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || !connected || isOffline}
          className="panel-btn-primary rounded-lg px-3 py-1.5 text-xs"
        >
          Send
        </button>
      </div>
    </div>
  );
}
