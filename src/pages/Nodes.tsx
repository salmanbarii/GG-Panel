import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { StatCard, UsageBar } from '@/components/StatCard';
import { useAuth } from '@/context/AuthContext';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { cn, timeAgo } from '@/lib/format';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import type { PanelNode } from '@/types';

interface WingsNodeInfo {
  id: string;
  name: string;
  url: string;
  tokenSet: boolean;
  createdAt: string;
}

export default function NodesPage() {
  const { isAdmin } = useAuth();
  const { success, error: showError } = useToast();
  const { run, busy } = useAsyncAction();

  const [nodes, setNodes] = useState<PanelNode[]>([]);
  const [wingsMeta, setWingsMeta] = useState<Map<string, WingsNodeInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [addWingsOpen, setAddWingsOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const [nodeName, setNodeName] = useState('');
  const [nodeHost, setNodeHost] = useState('');
  const [nodePort, setNodePort] = useState('');
  const [wingsName, setWingsName] = useState('');
  const [wingsUrl, setWingsUrl] = useState('');
  const [wingsToken, setWingsToken] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nodesRes, wingsRes] = await Promise.all([
        api.get<{ nodes: PanelNode[] }>('/nodes'),
        isAdmin
          ? api.get<{ nodes: WingsNodeInfo[] }>('/nodes/wings')
          : Promise.resolve({ data: { nodes: [] } }),
      ]);
      setNodes(nodesRes.data.nodes);
      if (wingsRes.data.nodes) {
        setWingsMeta(
          new Map(wingsRes.data.nodes.map((n) => [n.id, n])),
        );
      }
    } catch (err) {
      const msg = errorMessage(err, 'Failed to load nodes');
      setLoadError(msg);
      showError('Load failed', msg);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live node inventory pushed over Socket.IO.
  useSocketEvent<PanelNode[]>('nodes', (next) => {
    setNodes(next);
  });

  const handleAddNode = useCallback(async () => {
    if (!nodeName.trim() || !nodeHost.trim()) return;
    await run(
      async () => {
        const { data } = await api.post<{ node: PanelNode }>('/nodes', {
          name: nodeName.trim(),
          hostname: nodeHost.trim(),
          ...(nodePort ? { port: Number(nodePort) } : {}),
        });
        setNodes((curr) => [...curr, data.node]);
        setAddNodeOpen(false);
        setNodeName('');
        setNodeHost('');
        setNodePort('');
      },
      { successMessage: 'Node added' },
    );
  }, [run, nodeName, nodeHost, nodePort]);

  const handleAddWings = useCallback(async () => {
    if (!wingsName.trim() || !wingsUrl.trim() || !wingsToken.trim()) return;
    await run(
      async () => {
        const { data } = await api.post<{ node: { id: string; name: string; url: string; token?: string; createdAt?: string }; health: unknown }>('/nodes/wings', {
          name: wingsName.trim(),
          url: wingsUrl.trim(),
          token: wingsToken.trim(),
        });
        const { token: _token, ...safe } = data.node;
        setNodes((curr) => [
          ...curr,
          {
            id: safe.id,
            name: safe.name,
            kind: 'wings' as const,
            hostname: safe.url,
            online: false,
            serversCount: 0,
            cpuPercent: 0,
            cpuCores: 0,
            ramTotalMb: 0,
            ramUsedMb: 0,
            diskTotalGb: 0,
            diskUsedGb: 0,
            createdAt: safe.createdAt,
          },
        ]);
        setAddWingsOpen(false);
        setWingsName('');
        setWingsUrl('');
        setWingsToken('');
      },
      { successMessage: 'Wings node added' },
    );
  }, [run, wingsName, wingsUrl, wingsToken]);

  const handleRemove = useCallback(
    async (id: string) => {
      await run(
        async () => {
          await api.delete(`/nodes/${id}`);
          setNodes((curr) => curr.filter((n) => n.id !== id));
          setWingsMeta((curr) => {
            const next = new Map(curr);
            next.delete(id);
            return next;
          });
          setRemoveId(null);
        },
        { successMessage: 'Node removed' },
      );
    },
    [run],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Nodes"
        icon={<Network className="h-5 w-5" />}
        actions={
          <>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setAddNodeOpen(true)}
                  className="panel-btn-primary gap-1.5 text-sm"
                >
                  <Plus className="h-4 w-4" /> Add node
                </button>
                <button
                  type="button"
                  onClick={() => setAddWingsOpen(true)}
                  className="panel-btn-ghost gap-1.5 text-sm"
                >
                  <Plus className="h-4 w-4" /> Add Wings node
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="panel-btn-ghost gap-1.5 text-xs"
            >
              {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
          </>
        }
      />

      {loading && nodes.length === 0 && wingsMeta.size === 0 ? (
        <div className="flex items-center justify-center py-24">
          <PremiumLoader label="Loading nodes…" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <p className="text-sm text-red-300">{loadError}</p>
          <button type="button" onClick={() => void refresh()} className="panel-btn-primary text-xs">
            Retry
          </button>
        </div>
      ) : nodes.length === 0 && wingsMeta.size === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card flex flex-col items-center justify-center gap-4 py-20 text-center"
        >
          <Network className="h-12 w-12 text-zinc-600" />
          <p className="text-zinc-400">No nodes configured</p>
        </motion.div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {nodes.map((node, index) => {
              const meta = wingsMeta.get(node.id);
              return (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  className="panel-card p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-white">{node.name}</h3>
                        <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                          {node.kind}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {node.hostname}
                        {node.port ? `:${node.port}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-block h-2.5 w-2.5 rounded-full',
                          node.online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-red-500',
                        )}
                        title={node.online ? 'Online' : 'Offline'}
                      />
                      {isAdmin && node.id !== 'local' && (
                        <button
                          type="button"
                          onClick={() => setRemoveId(node.id)}
                          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-red-500/10 hover:text-red-400"
                          aria-label={`Remove ${node.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <UsageBar
                      label="CPU"
                      used={node.cpuPercent}
                      total={100}
                      unit="%"
                      formatValue={(used) => `${used.toFixed(1)}%`}
                    />
                    <UsageBar
                      label="RAM"
                      used={node.ramUsedMb}
                      total={node.ramTotalMb}
                      formatValue={(used, total) => {
                        const u = (used / 1024).toFixed(1);
                        const t = total > 0 ? (total / 1024).toFixed(1) : '0.0';
                        return `${u} GB / ${t} GB`;
                      }}
                    />
                    <UsageBar
                      label="Disk"
                      used={node.diskUsedGb}
                      total={node.diskTotalGb}
                      formatValue={(used, total) => {
                        const u = used.toFixed(1);
                        const t = total.toFixed(1);
                        return `${u} GB / ${t} GB`;
                      }}
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                    <span>
                      {node.serversCount} server{node.serversCount === 1 ? '' : 's'}
                    </span>
                    {meta && node.kind === 'wings' && (
                      <span
                        className={cn(
                          'font-medium',
                          meta.tokenSet ? 'text-emerald-400' : 'text-amber-400',
                        )}
                      >
                        {meta.tokenSet ? 'Token set' : 'Token missing'}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={addNodeOpen}
        onClose={() => setAddNodeOpen(false)}
        title="Add node"
        icon={<Plus className="h-4 w-4" />}
        footer={
          <>
            <button
              type="button"
              className="panel-btn-ghost"
              onClick={() => setAddNodeOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="panel-btn-primary"
              onClick={() => void handleAddNode()}
              disabled={busy || !nodeName.trim() || !nodeHost.trim()}
            >
              {busy && <Spinner />} Add
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="panel-label" htmlFor="node-name">Name</label>
            <input
              id="node-name"
              className="panel-input"
              value={nodeName}
              onChange={(e) => setNodeName(e.target.value)}
              placeholder="e.g. US-East"
            />
          </div>
          <div>
            <label className="panel-label" htmlFor="node-host">Hostname</label>
            <input
              id="node-host"
              className="panel-input"
              value={nodeHost}
              onChange={(e) => setNodeHost(e.target.value)}
              placeholder="e.g. 10.0.0.1"
            />
          </div>
          <div>
            <label className="panel-label" htmlFor="node-port">Port (optional)</label>
            <input
              id="node-port"
              className="panel-input"
              type="number"
              value={nodePort}
              onChange={(e) => setNodePort(e.target.value)}
              placeholder="8080"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={addWingsOpen}
        onClose={() => setAddWingsOpen(false)}
        title="Add Wings node"
        icon={<Plus className="h-4 w-4" />}
        footer={
          <>
            <button
              type="button"
              className="panel-btn-ghost"
              onClick={() => setAddWingsOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="panel-btn-primary"
              onClick={() => void handleAddWings()}
              disabled={busy || !wingsName.trim() || !wingsUrl.trim() || !wingsToken.trim()}
            >
              {busy && <Spinner />} Add
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="panel-label" htmlFor="wings-name">Name</label>
            <input
              id="wings-name"
              className="panel-input"
              value={wingsName}
              onChange={(e) => setWingsName(e.target.value)}
              placeholder="e.g. Wings-1"
            />
          </div>
          <div>
            <label className="panel-label" htmlFor="wings-url">Wings URL</label>
            <input
              id="wings-url"
              className="panel-input"
              value={wingsUrl}
              onChange={(e) => setWingsUrl(e.target.value)}
              placeholder="https://node.example.com:8080"
            />
          </div>
          <div>
            <label className="panel-label" htmlFor="wings-token">Token</label>
            <input
              id="wings-token"
              className="panel-input"
              value={wingsToken}
              onChange={(e) => setWingsToken(e.target.value)}
              placeholder="Pterodactyl Wings token"
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeId)}
        onClose={() => setRemoveId(null)}
        onConfirm={() => removeId && void handleRemove(removeId)}
        title="Remove node"
        message="This will remove the node from the panel."
        confirmLabel="Remove"
        danger
        busy={busy}
      />
    </div>
  );
}
