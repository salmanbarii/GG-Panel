import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Key,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Globe,
  Lock,
  AlertTriangle,
  Loader2,
  Plus,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { cn, serverAddress, copyToClipboard } from '@/lib/format';
import type { GameServerView, SftpCredentials } from '@/types';

interface ServerSFTPProps {
  server: GameServerView;
  onRefresh?: () => void;
}

interface SftpResponse {
  sftp: SftpCredentials;
}

export function ServerSFTP({ server, onRefresh }: ServerSFTPProps) {
  const { success, error } = useToast();
  const { run, busy } = useAsyncAction();

  const [credentials, setCredentials] = useState<SftpCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [copiedHost, setCopiedHost] = useState(false);
  const [copiedPort, setCopiedPort] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [regenerateTarget, setRegenerateTarget] = useState(false);
  const [regenerateBusy, setRegenerateBusy] = useState(false);

  const fetchSftp = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<SftpResponse>(`/servers/${server.id}/sftp`);
      setCredentials(data.sftp);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load SFTP credentials'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSftp();
  }, [server.id]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data } = await api.post<SftpResponse>(`/servers/${server.id}/sftp`);
      setCredentials(data.sftp);
      success('SFTP credentials generated', 'Copy the password now — it will not be shown again.');
      onRefresh?.();
    } catch (err) {
      error('Failed to generate credentials', errorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerateBusy(true);
    try {
      const { data } = await api.post<SftpResponse>(`/servers/${server.id}/sftp`);
      setCredentials(data.sftp);
      setShowPassword(true);
      success('SFTP password regenerated', 'Copy the new password now — it will not be shown again.');
      setRegenerateTarget(false);
      onRefresh?.();
    } catch (err) {
      error('Failed to regenerate credentials', errorMessage(err));
    } finally {
      setRegenerateBusy(false);
    }
  };

  const handleRemove = async () => {
    setRemoveBusy(true);
    try {
      await api.delete(`/servers/${server.id}/sftp`);
      success('SFTP access removed');
      setRemoveTarget(false);
      setCredentials(null);
      onRefresh?.();
    } catch (err) {
      error('Failed to remove SFTP', errorMessage(err));
    } finally {
      setRemoveBusy(false);
    }
  };

  const handleCopy = async (text: string, setCopied: (v: boolean) => void) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      success('Copied');
      setTimeout(() => setCopied(false), 2000);
    } else {
      error('Failed to copy');
    }
  };

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm text-red-200">{loadError}</p>
          <button type="button" onClick={fetchSftp} className="panel-btn-ghost text-xs py-1.5">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <PremiumLoader label="Loading SFTP" />
      </div>
    );
  }

  const host = credentials?.host ?? serverAddress(server);
  const port = credentials?.port ?? 22;
  const username = credentials?.username ?? server.name;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">SFTP</h3>
          <p className="text-xs text-zinc-500">
            {credentials?.exists ? 'Credentials configured' : 'Not configured'}
          </p>
        </div>
        {credentials?.exists && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchSftp}
              className="panel-btn-ghost gap-1.5 text-xs py-2"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              type="button"
              onClick={() => setRegenerateTarget(true)}
              className="panel-btn-ghost gap-1.5 text-xs py-2 border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
            >
              <RefreshCw className="h-4 w-4" /> Regenerate
            </button>
            <button
              type="button"
              onClick={() => setRemoveTarget(true)}
              className="panel-btn-danger gap-1.5 text-xs py-2"
            >
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          </div>
        )}
      </div>

      {!credentials?.exists ? (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <Lock className="h-10 w-10 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">SFTP is not configured for this server.</p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="panel-btn-primary mt-4 gap-1.5 text-xs py-2"
          >
            {generating ? <Spinner /> : <Plus className="h-4 w-4" />}
            Generate credentials
          </button>
        </div>
      ) : (
        <div className="panel-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Key className="h-4 w-4" />
            <span className="font-medium uppercase tracking-wider">Connection details</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="panel-label">Host</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={host}
                  className="panel-input text-xs py-2"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(host, setCopiedHost)}
                  className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                  aria-label="Copy host"
                >
                  {copiedHost ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {server.playitTunnel?.publicAddress && (
                <p className="mt-1 text-[10px] text-zinc-500">
                  Playit: {server.playitTunnel.publicAddress}
                </p>
              )}
            </div>

            <div>
              <label className="panel-label">Port</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={String(port)}
                  className="panel-input text-xs py-2"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(String(port), setCopiedPort)}
                  className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                  aria-label="Copy port"
                >
                  {copiedPort ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="panel-label">Username</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={username}
                  className="panel-input text-xs py-2"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(username, setCopiedHost)}
                  className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                  aria-label="Copy username"
                >
                  {copiedHost ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="panel-label">Password</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={showPassword ? credentials.password ?? '' : '••••••••'}
                  className="panel-input text-xs py-2"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Lock className="h-4 w-4" />
                </button>
                {credentials.password && (
                  <button
                    type="button"
                    onClick={() => handleCopy(credentials.password!, setCopiedPassword)}
                    className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                    aria-label="Copy password"
                  >
                    {copiedPassword ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {credentials.password && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Password shown once. Copy it before regenerating.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-200">
            <div className="flex items-start gap-2">
              <Globe className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Connect with: <strong>{username}@{host}</strong> on port <strong>{port}</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={regenerateTarget}
        onClose={() => setRegenerateTarget(false)}
        onConfirm={handleRegenerate}
        title="Regenerate SFTP password"
        message={
          <span>
            This will reset the password for <strong>{server.name}</strong>. The old password will stop working immediately. Copy the new password when it appears.
          </span>
        }
        confirmLabel="Regenerate"
        danger
        busy={regenerateBusy}
      />

      <ConfirmDialog
        open={removeTarget}
        onClose={() => setRemoveTarget(false)}
        onConfirm={handleRemove}
        title="Remove SFTP"
        message={
          <span>
            Remove SFTP access for <strong>{server.name}</strong>? Users will no longer be able to connect via SFTP.
          </span>
        }
        confirmLabel="Remove"
        danger
        busy={removeBusy}
      />
    </div>
  );
}
