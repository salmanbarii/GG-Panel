import { useState, useEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import {
  Globe,
  RefreshCw,
  Upload,
  MapPin,
  Copy,
  Check,
  HardDrive,
  X,
  Loader2,
  AlertTriangle,
  Download,
  Play,
  Shield,
  Crosshair,
  Timer,
  Ruler,
  PackageOpen,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { cn, formatBytes, formatDate, formatUptime, copyToClipboard } from '@/lib/format';
import type { WorldInfo } from '@/types';

import type { GameServerView } from '@/types';

interface WorldManagerProps {
  server: GameServerView;
  onRefresh?: () => void;
}

interface WorldInfoResponse {
  world: WorldInfo;
}

export function WorldManager({ server, onRefresh }: WorldManagerProps) {
  const { success, error, info } = useToast();
  const { run, busy } = useAsyncAction();

  const [world, setWorld] = useState<WorldInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importName, setImportName] = useState('');
  const [importKeepBackup, setImportKeepBackup] = useState(true);
  const [importForce, setImportForce] = useState(false);
  const [import409, setImport409] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [copiedSeed, setCopiedSeed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const fetchWorld = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<WorldInfoResponse>(`/servers/${server.id}/world/info`);
      setWorld(data.world);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load world info'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorld();
  }, [server.id]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const { data } = await api.post<WorldInfoResponse>(`/servers/${server.id}/world/analyze`);
      setWorld(data.world);
      success('World analyzed');
    } catch (err) {
      error('Failed to analyze world', errorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleImport = async (e: FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    setImporting(true);
    setImportProgress(0);
    setImport409(false);
    try {
      const form = new FormData();
      form.append('world', importFile);
      if (importName.trim()) form.append('name', importName.trim());
      form.append('force', String(importForce));
      form.append('keepBackup', String(importKeepBackup));
      await api.post(`/servers/${server.id}/world/import`, form, {
        onUploadProgress: (event) => {
          const total = event.total ?? importFile.size;
          setImportProgress(Math.min(100, Math.round((event.loaded / total) * 100)));
        },
      });
      success('World imported');
      setImportFile(null);
      setImportName('');
      setImportKeepBackup(true);
      setImportForce(false);
      setImportProgress(null);
      fetchWorld();
      onRefresh?.();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 409 && !importForce) {
        setImport409(true);
      } else {
        error('Failed to import world', errorMessage(err));
        setImportProgress(null);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setImport409(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopySeed = async () => {
    if (!world?.seed) return;
    const ok = await copyToClipboard(world.seed);
    if (ok) {
      setCopiedSeed(true);
      setTimeout(() => setCopiedSeed(false), 2000);
      success('Seed copied');
    } else {
      error('Failed to copy seed');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.zip')) {
      setImportFile(file);
      setImport409(false);
    } else {
      error('Please drop a .zip file');
    }
  };

  const isRunning = server.isRunning;

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm text-red-200">{loadError}</p>
          <button type="button" onClick={fetchWorld} className="panel-btn-ghost text-xs py-1.5">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading || !world) {
    return (
      <div className="flex items-center justify-center p-12">
        <PremiumLoader label="Loading world" />
      </div>
    );
  }

  if (!world.exists) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <PackageOpen className="h-10 w-10 text-zinc-700" />
        <p className="mt-3 text-sm text-zinc-500">No world found yet — start the server once to generate one.</p>
      </div>
    );
  }

  const difficultyLabel = ['peaceful', 'easy', 'normal', 'hard'][world.difficulty ?? 2] ?? `Unknown (${world.difficulty})`;
  const gameTypeLabel = ['survival', 'creative', 'adventure', 'spectator'][world.gameType ?? 0] ?? `Unknown (${world.gameType})`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">World</h3>
          <p className="text-xs text-zinc-500">{world.name || 'Unnamed'}</p>
        </div>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={analyzing}
          className="panel-btn-ghost gap-1.5 text-xs py-2"
        >
          {analyzing ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
          Re-analyze
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard label="Level name" value={world.levelName ?? '—'} icon={<Globe className="h-4 w-4" />} />
        <InfoCard label="Version" value={world.version ?? '—'} icon={<Globe className="h-4 w-4" />} />
        <InfoCard label="Seed" value={world.seed ?? '—'} icon={<Crosshair className="h-4 w-4" />} copyable={!!world.seed} onCopy={handleCopySeed} copied={copiedSeed} />
        <InfoCard label="Difficulty" value={difficultyLabel} icon={<Shield className="h-4 w-4" />} />
        <InfoCard label="Gametype" value={gameTypeLabel} icon={<Crosshair className="h-4 w-4" />} />
        <div className="panel-card p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Flags</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {world.hardcore && (
              <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">Hardcore</span>
            )}
            {world.allowCommands && (
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">Commands enabled</span>
            )}
          </div>
        </div>
        <InfoCard label="Size" value={formatBytes(world.sizeBytes)} icon={<HardDrive className="h-4 w-4" />} />
        <InfoCard label="Last played" value={formatDate(world.lastPlayed)} icon={<Timer className="h-4 w-4" />} />
        {world.spawn && (
          <InfoCard
            label="Spawn"
            value={`${world.spawn.x}, ${world.spawn.y}, ${world.spawn.z}`}
            icon={<MapPin className="h-4 w-4" />}
          />
        )}
        <div className="panel-card p-3 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Dimensions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {world.dimensions.map((dim) => (
              <span key={dim} className="rounded-md border border-theme-500/30 bg-theme-500/10 px-2 py-0.5 text-xs text-theme-300">
                {dim}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-zinc-200">Import world</h4>
        <p className="text-xs text-zinc-500">
          Upload a <strong>.zip</strong> archive containing your world folder. The server must be stopped.
        </p>

        {isRunning && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            The server is running. Importing requires the server to be stopped.
          </div>
        )}

        {import409 && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            The server must be stopped before importing a world.
          </div>
        )}

        <form onSubmit={handleImport} className="space-y-3">
          <div
            className={cn(
              'relative rounded-xl border border-dashed border-white/10 bg-black/30 p-6 text-center transition',
              isDragOver && 'border-theme-500/60 bg-theme-500/10',
            )}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              className="hidden"
            />
            {importFile ? (
              <div className="flex items-center justify-center gap-2">
                <PackageOpen className="h-5 w-5 text-theme-400" />
                <span className="text-sm text-zinc-200">{importFile.name}</span>
                <button
                  type="button"
                  onClick={() => setImportFile(null)}
                  className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-8 w-8 text-zinc-600" />
                <p className="mt-2 text-sm text-zinc-400">Drop a .zip here or click to browse</p>
              </>
            )}
            {!importFile && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 panel-btn-ghost text-xs py-2"
              >
                Browse
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="panel-label">Target world name (optional)</label>
              <input
                type="text"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="world"
                className="panel-input text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={importKeepBackup}
              onChange={(e) => setImportKeepBackup(e.target.checked)}
              className="rounded border-white/20 bg-black/40"
            />
            Keep a backup of the existing world
          </label>

          {isRunning && (
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={importForce}
                onChange={(e) => setImportForce(e.target.checked)}
                className="rounded border-white/20 bg-black/40"
              />
              Force import (stop server and import)
            </label>
          )}

          {importProgress !== null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Uploading…</span>
                <span>{importProgress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-theme-500 transition-all"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!importFile || importing}
              className="panel-btn-primary gap-1.5 text-xs py-2"
            >
              {importing ? <Spinner /> : <Upload className="h-4 w-4" />}
              {importing ? 'Importing…' : 'Import world'}
            </button>
            {isRunning && importForce && (
              <span className="text-xs text-amber-400">Server will be stopped during import.</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function InfoCard({
  label,
  value,
  icon,
  copyable,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  copyable?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="panel-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="truncate text-sm text-zinc-200">{value}</span>
        {copyable && (
          <button
            type="button"
            onClick={onCopy}
            className="rounded-md p-1 text-zinc-500 transition hover:bg-white/10 hover:text-white"
            aria-label="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
