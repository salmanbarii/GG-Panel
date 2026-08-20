import { useState, useEffect, useRef, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen,
  FileText,
  Image,
  Archive,
  Settings,
  Code2,
  Binary,
  File,
  Upload,
  FolderPlus,
  FilePlus,
  Download,
  Trash2,
  MoreHorizontal,
  RefreshCw,
  ChevronRight,
  Search,
  X,
  Save,
  HardDrive,
  Check,
  AlertTriangle,
  Copy,
  FolderInput,
  FileArchive,
  ArrowUpToLine,
} from 'lucide-react';
import { api, getToken, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { useUploads } from '@/context/UploadContext';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { cn, formatBytes, formatDate, timeAgo, fileIconName } from '@/lib/format';
import type { FileEntry, FileListing } from '@/types';

const ICON_MAP: Record<string, typeof FolderOpen> = {
  folder: FolderOpen,
  archive: Archive,
  settings: Settings,
  image: Image,
  text: FileText,
  code: Code2,
  binary: Binary,
  file: File,
};

import type { GameServerView } from '@/types';

interface FileManagerProps {
  server: GameServerView;
  onRefresh?: () => void;
}

export function FileManager({ server, onRefresh }: FileManagerProps) {
  const { success, error, info } = useToast();
  const { run, busy } = useAsyncAction();
  const { uploads, enqueue, cancel, clearFinished } = useUploads();

  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPath, setEditorPath] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const syncScroll = () => {
    if (editorRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = editorRef.current.scrollTop;
    }
  };

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const [createModal, setCreateModal] = useState<'file' | 'folder' | null>(null);
  const [createName, setCreateName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const [renameModal, setRenameModal] = useState<{ from: string; to: string } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const serverUploads = uploads.filter((u) => u.serverId === server.id);

  const currentPath = listing?.path ?? '/';
  const entries = listing?.entries ?? [];

  const filteredEntries = searchQuery.trim()
    ? entries.filter((e) => e.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : entries;

  const allSelected = filteredEntries.length > 0 && selectedPaths.size === filteredEntries.length;
  const selectedEntries = filteredEntries.filter((e) => selectedPaths.has(e.path));

  const fetchListing = useCallback(async (path: string) => {
    setLoading(true);
    setLoadError(null);
    setSelectedPaths(new Set());
    try {
      const { data } = await api.get<FileListing>(`/servers/${server.id}/files`, { params: { path } });
      setListing(data);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load files'));
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  useEffect(() => {
    fetchListing('/');
  }, [fetchListing]);

  const handleRefresh = () => fetchListing(currentPath);

  const navigateTo = (path: string) => {
    fetchListing(path);
  };

  const openFile = async (entry: FileEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path);
      return;
    }
    setEditorPath(entry.path);
    setEditorContent('');
    setEditorDirty(false);
    setEditorError(null);
    setEditorOpen(true);
    setLoading(true);
    try {
      const { data } = await api.get<{ path: string; content: string; size: number; modifiedAt: string }>(
        `/servers/${server.id}/files/content`,
        { params: { path: entry.path } },
      );
      setEditorContent(data.content);
    } catch (err) {
      if ((err as Error & { status?: number }).status === 415) {
        setEditorError('This file appears to be binary and cannot be edited here.');
      } else if ((err as Error & { status?: number }).status === 413) {
        setEditorError('File is too large to open in the editor.');
      } else {
        setEditorError(errorMessage(err, 'Failed to open file'));
      }
    } finally {
      setLoading(false);
    }
  };

  const saveEditor = async () => {
    if (!editorDirty) return;
    setEditorSaving(true);
    try {
      await api.post(`/servers/${server.id}/files/save`, { path: editorPath, content: editorContent });
      setEditorDirty(false);
      success('File saved');
    } catch (err) {
      error('Failed to save file', errorMessage(err));
    } finally {
      setEditorSaving(false);
    }
  };

  const handleEditorKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveEditor();
    }
    if (e.key === 'Escape') {
      if (editorDirty) {
        if (window.confirm('You have unsaved changes. Close anyway?')) setEditorOpen(false);
      } else {
        setEditorOpen(false);
      }
    }
  };

  const handleCreate = async (e?: FormEvent) => {
    e?.preventDefault();
    const name = createName.trim();
    if (!name || name.includes('/') || name.includes('..')) return;
    setCreateBusy(true);
    try {
      const path = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
      if (createModal === 'folder') {
        await api.post(`/servers/${server.id}/files/mkdir`, { path });
        success('Folder created');
      } else {
        await api.post(`/servers/${server.id}/files/create`, { path, content: '' });
        success('File created');
      }
      setCreateModal(null);
      setCreateName('');
      fetchListing(currentPath);
      onRefresh?.();
    } catch (err) {
      error('Failed to create', errorMessage(err));
    } finally {
      setCreateBusy(false);
    }
  };

  const handleRename = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!renameModal) return;
    const to = renameModal.to.trim();
    if (!to || to.includes('/') || to.includes('..')) return;
    setRenameBusy(true);
    try {
      await api.post(`/servers/${server.id}/files/rename`, { from: renameModal.from, to });
      success('Renamed');
      setRenameModal(null);
      fetchListing(currentPath);
      onRefresh?.();
    } catch (err) {
      error('Failed to rename', errorMessage(err));
    } finally {
      setRenameBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/servers/${server.id}/files`, { data: { paths: deleteConfirm } });
      success('Deleted');
      setDeleteConfirm(null);
      fetchListing(currentPath);
      onRefresh?.();
    } catch (err) {
      error('Failed to delete', errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleDownload = (path: string) => {
    const token = getToken();
    const url = `/api/servers/${server.id}/files/download?path=${encodeURIComponent(path)}${token ? `&token=${token}` : ''}`;
    window.open(url, '_blank');
  };

  const handleBulkDownload = () => {
    if (selectedEntries.length === 1) {
      handleDownload(selectedEntries[0].path);
    } else {
      const paths = selectedEntries.map((e) => e.path);
      const payload = paths.join('|');
      const token = getToken();
      const url = `/api/servers/${server.id}/files/download?paths=${encodeURIComponent(payload)}${token ? `&token=${token}` : ''}`;
      window.open(url, '_blank');
    }
  };

  const handleBulkZip = async () => {
    if (selectedEntries.length === 0) return;
    const paths = selectedEntries.map((e) => e.path);
    try {
      const { data } = await api.post<{ zipPath: string }>(`/servers/${server.id}/files/zip`, {
        paths,
        destination: currentPath,
        name: `archive-${Date.now()}.zip`,
      });
      success('Archive created');
      setSelectedPaths(new Set());
      fetchListing(currentPath);
    } catch (err) {
      error('Failed to create archive', errorMessage(err));
    }
  };

  const handleUnzip = async (entry: FileEntry) => {
    try {
      await api.post(`/servers/${server.id}/files/unzip`, { path: entry.path, destination: currentPath });
      success('Extracted');
      fetchListing(currentPath);
    } catch (err) {
      error('Failed to extract', errorMessage(err));
    }
  };

  const handleDuplicateZip = async (entry: FileEntry) => {
    try {
      await api.post(`/servers/${server.id}/files/zip`, {
        paths: [entry.path],
        destination: currentPath,
        name: entry.name.replace(/\.zip$/i, '') + '-copy.zip',
      });
      success('Archive duplicated');
      fetchListing(currentPath);
    } catch (err) {
      error('Failed to duplicate archive', errorMessage(err));
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
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    files.forEach((file) => {
      enqueue({ serverId: server.id, file, targetPath: currentPath, autoExtract: false });
    });
    info(`Uploading ${files.length} file(s)`);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    files.forEach((file) => {
      enqueue({ serverId: server.id, file, targetPath: currentPath, autoExtract: false });
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(filteredEntries.map((e) => e.path)));
    }
  };

  const breadcrumbs = (() => {
    const parts = currentPath.split('/').filter(Boolean);
    const crumbs = [{ label: 'Root', path: '/' }];
    let accum = '';
    for (const part of parts) {
      accum += `/${part}`;
      crumbs.push({ label: part, path: accum });
    }
    return crumbs;
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-1 rounded-xl border border-white/10 bg-black/40 px-2 py-1">
          {currentPath !== '/' && (
            <button
              type="button"
              onClick={() => navigateTo(listing?.parent ?? '/')}
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Go up"
            >
              <ArrowUpToLine className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-600" />}
                <button
                  type="button"
                  onClick={() => navigateTo(crumb.path)}
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-sm transition',
                    i === breadcrumbs.length - 1
                      ? 'text-theme-400 font-medium'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5',
                  )}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Filter files…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="panel-input pl-9 w-48"
          />
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setCreateModal('file'); setCreateName(''); }}
          className="panel-btn-ghost gap-1.5 text-xs py-2"
        >
          <FilePlus className="h-3.5 w-3.5" /> New file
        </button>
        <button
          type="button"
          onClick={() => { setCreateModal('folder'); setCreateName(''); }}
          className="panel-btn-ghost gap-1.5 text-xs py-2"
        >
          <FolderPlus className="h-3.5 w-3.5" /> New folder
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="panel-btn-ghost gap-1.5 text-xs py-2"
        >
          <Upload className="h-3.5 w-3.5" /> Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      <AnimatePresence>
        {selectedPaths.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-theme-500/30 bg-theme-500/10 p-2"
          >
            <span className="text-xs font-medium text-theme-400">{selectedPaths.size} selected</span>
            <button type="button" onClick={handleBulkDownload} className="panel-btn-ghost gap-1.5 text-xs py-1.5">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
            <button type="button" onClick={handleBulkZip} className="panel-btn-ghost gap-1.5 text-xs py-1.5">
              <FileArchive className="h-3.5 w-3.5" /> Zip
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirm(Array.from(selectedPaths))}
              className="panel-btn-danger gap-1.5 text-xs py-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <button
              type="button"
              onClick={() => setSelectedPaths(new Set())}
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {serverUploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Uploads</span>
              <button type="button" onClick={clearFinished} className="text-xs text-zinc-500 hover:text-white">
                Clear finished
              </button>
            </div>
            {serverUploads.map((u) => (
              <div key={u.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate text-zinc-300">{u.filename}</span>
                    <span className="text-zinc-500">{Math.round(u.progress)}%</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-theme-500 transition-all"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                </div>
                {u.status === 'uploading' && (
                  <button
                    type="button"
                    onClick={() => cancel(u.id)}
                    className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                    aria-label="Cancel upload"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          'panel-card relative overflow-hidden transition',
          isDragOver && 'border-theme-500/60 bg-theme-500/10',
        )}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="rounded-2xl border border-dashed border-theme-500 bg-theme-500/10 p-8 text-center">
              <Upload className="mx-auto h-8 w-8 text-theme-400" />
              <p className="mt-2 text-sm font-medium text-theme-300">Drop files to upload</p>
            </div>
          </div>
        )}

        {loadError && (
          <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
            <p className="flex-1 text-sm text-red-200">{loadError}</p>
            <button type="button" onClick={handleRefresh} className="panel-btn-ghost text-xs py-1.5">
              Retry
            </button>
          </div>
        )}

        {loading && !listing ? (
          <div className="flex items-center justify-center p-12">
            <PremiumLoader label="Loading files" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <HardDrive className="h-10 w-10 text-zinc-700" />
            <p className="mt-3 text-sm text-zinc-500">
              {searchQuery ? 'No files match your filter' : 'This directory is empty'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-zinc-500">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-white/20 bg-black/40"
                    />
                  </th>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="w-28 px-3 py-2.5">Size</th>
                  <th className="w-40 px-3 py-2.5">Modified</th>
                  <th className="w-28 px-3 py-2.5">Permissions</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const Icon = ICON_MAP[fileIconName(entry.name, entry.isDirectory)] ?? File;
                  const isSelected = selectedPaths.has(entry.path);
                  return (
                    <motion.tr
                      key={entry.path}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        'group border-b border-white/5 transition',
                        isSelected && 'bg-theme-500/5',
                      )}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(entry.path)}
                          className="rounded border-white/20 bg-black/40"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => openFile(entry)}
                          className="flex items-center gap-2.5 text-left transition hover:text-theme-400"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
                          <span className="truncate text-zinc-200">{entry.name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-zinc-500">
                        {entry.isDirectory ? '—' : formatBytes(entry.size)}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">{timeAgo(entry.modifiedAt)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-600">
                        {entry.mode ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setContextMenu({ x: rect.left, y: rect.bottom + 4, entry });
                            }}
                            className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
                            aria-label="More actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.1 }}
            className="fixed z-50 w-56 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/98 py-1 shadow-2xl backdrop-blur-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseLeave={() => setContextMenu(null)}
          >
            {contextMenu.entry.isDirectory ? (
              <button
                type="button"
                onClick={() => { navigateTo(contextMenu.entry.path); setContextMenu(null); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/5"
              >
                <FolderOpen className="h-4 w-4" /> Open
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { openFile(contextMenu.entry); setContextMenu(null); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/5"
              >
                <FileText className="h-4 w-4" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => { handleDownload(contextMenu.entry.path); setContextMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/5"
            >
              <Download className="h-4 w-4" /> Download
            </button>
            <button
              type="button"
              onClick={() => {
                setRenameModal({ from: contextMenu.entry.path, to: contextMenu.entry.name });
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/5"
            >
              <Copy className="h-4 w-4" /> Rename
            </button>
            {contextMenu.entry.name.toLowerCase().endsWith('.zip') && (
              <button
                type="button"
                onClick={() => { handleDuplicateZip(contextMenu.entry); setContextMenu(null); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/5"
              >
                <FileArchive className="h-4 w-4" /> Duplicate archive
              </button>
            )}
            {contextMenu.entry.name.toLowerCase().endsWith('.zip') && (
              <button
                type="button"
                onClick={() => { handleUnzip(contextMenu.entry); setContextMenu(null); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/5"
              >
                <FolderInput className="h-4 w-4" /> Extract here
              </button>
            )}
            <button
              type="button"
              onClick={() => { setDeleteConfirm([contextMenu.entry.path]); setContextMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="Delete files"
        message={
          <span>
            This will permanently delete <strong>{deleteConfirm?.length ?? 0}</strong> item(s). This action cannot be undone.
          </span>
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
      />

      <Modal
        open={createModal !== null}
        onClose={() => { setCreateModal(null); setCreateName(''); }}
        title={createModal === 'folder' ? 'New folder' : 'New file'}
        description={createModal === 'folder' ? 'Enter a name for the new folder.' : 'Enter a name for the new file.'}
        size="sm"
        footer={
          <>
            <button type="button" className="panel-btn-ghost" onClick={() => { setCreateModal(null); setCreateName(''); }} disabled={createBusy}>
              Cancel
            </button>
            <button type="button" className="panel-btn-primary" onClick={handleCreate} disabled={createBusy}>
              {createBusy && <Spinner />}
              {createModal === 'folder' ? 'Create folder' : 'Create file'}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreate}>
          <label className="panel-label">Name</label>
          <input
            className="panel-input"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={createModal === 'folder' ? 'my-folder' : 'config.yml'}
            autoFocus
          />
        </form>
      </Modal>

      <Modal
        open={renameModal !== null}
        onClose={() => setRenameModal(null)}
        title="Rename"
        size="sm"
        footer={
          <>
            <button type="button" className="panel-btn-ghost" onClick={() => setRenameModal(null)} disabled={renameBusy}>
              Cancel
            </button>
            <button type="button" className="panel-btn-primary" onClick={handleRename} disabled={renameBusy}>
              {renameBusy && <Spinner />}
              Rename
            </button>
          </>
        }
      >
        <form onSubmit={handleRename}>
          <label className="panel-label">New name</label>
          <input
            className="panel-input"
            value={renameModal?.to ?? ''}
            onChange={(e) => setRenameModal((prev) => prev ? { ...prev, to: e.target.value } : null)}
            placeholder="new-name"
            autoFocus
          />
        </form>
      </Modal>

      <Modal
        open={editorOpen}
        onClose={() => {
          if (editorDirty) {
            if (window.confirm('You have unsaved changes. Close anyway?')) {
              setEditorOpen(false);
            }
          } else {
            setEditorOpen(false);
          }
        }}
        title={editorPath.split('/').pop() ?? 'File editor'}
        description={editorDirty ? 'Unsaved changes' : undefined}
        size="xl"
        footer={
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-zinc-500">
              {editorDirty ? 'Unsaved changes' : 'Saved'} · Ctrl+S to save
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="panel-btn-ghost"
                onClick={() => {
                  if (editorDirty && window.confirm('Discard changes?')) setEditorOpen(false);
                  else setEditorOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="panel-btn-primary"
                onClick={saveEditor}
                disabled={!editorDirty || editorSaving}
              >
                {editorSaving && <Spinner />}
                <Save className="h-4 w-4" /> Save
              </button>
            </div>
          </div>
        }
      >
        {editorError && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {editorError}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <PremiumLoader label="Opening file" />
          </div>
        ) : (
          <div className="flex h-[60vh] overflow-hidden rounded-xl border border-white/10 bg-black/40">
            <div
              ref={gutterRef}
              className="hidden select-none border-r border-white/10 bg-black/30 py-3 pl-3 pr-2 text-right font-mono text-xs leading-6 text-zinc-600 scrollbar-none sm:block"
              aria-hidden="true"
            >
              {editorContent.split('\n').map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={editorRef}
              value={editorContent}
              onChange={(e) => {
                setEditorContent(e.target.value);
                setEditorDirty(true);
              }}
              onKeyDown={handleEditorKeyDown}
              spellCheck={false}
              className="flex-1 resize-none bg-transparent p-3 font-mono text-sm leading-6 text-zinc-200 outline-none scrollbar-none"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
