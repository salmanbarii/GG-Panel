import { useState, useEffect, useMemo } from 'react';
import {
  Save,
  Server,
  RefreshCw,
  Shield,
  UserPlus,
  Loader2,
  Play,
  StopCircle,
  Download,
  Gauge,
  HardDrive,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { SearchableDropdown } from '@/components/SearchableDropdown';
import { ResourcesSlider } from '@/components/ResourcesSlider';
import { useSettings } from '@/context/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/format';
import type { GameServerView, PanelNode, PublicUser } from '@/types';

interface ServerSettingsProps {
  server: GameServerView;
  onRefresh?: () => void;
}

interface VersionsResponse {
  versions: string[];
}

interface NodesResponse {
  nodes: PanelNode[];
}

interface CheckPortResponse {
  available: boolean;
}

interface UsersResponse {
  users: PublicUser[];
}

const RUNTIME_LABELS: Record<string, string> = {
  docker: 'Docker',
  local: 'Local',
  wings: 'Wings',
};

export function ServerSettings({ server, onRefresh }: ServerSettingsProps) {
  const { success, error, info } = useToast();
  const { busy } = useAsyncAction();
  const { settings } = useSettings();
  const { isAdmin } = useAuth();

  const [name, setName] = useState(server.name);
  const [port, setPort] = useState(String(server.port));
  const [ipAlias, setIpAlias] = useState(server.ipAlias ?? '');
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [portChecking, setPortChecking] = useState(false);
  const [portAvailable, setPortAvailable] = useState<boolean | null>(null);

  const [versions, setVersions] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(server.version);
  const [changingVersion, setChangingVersion] = useState(false);

  const [ram, setRam] = useState(server.ram);
  const [cpu, setCpu] = useState(server.cpu);
  const [savingResources, setSavingResources] = useState(false);

  const [runtimeType, setRuntimeType] = useState(server.runtimeType);
  const [nodes, setNodes] = useState<PanelNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(server.nodeId);
  const [migrating, setMigrating] = useState(false);

  const [reinstallTarget, setReinstallTarget] = useState(false);
  const [reinstallBusy, setReinstallBusy] = useState(false);

  const [suspending, setSuspending] = useState(false);
  const [ownerUsers, setOwnerUsers] = useState<PublicUser[]>([]);
  const [loadingOwnerUsers, setLoadingOwnerUsers] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState(server.owner);

  const dirty = name !== server.name || String(port) !== String(server.port) || ipAlias !== (server.ipAlias ?? '');

  useEffect(() => {
    setName(server.name);
    setPort(String(server.port));
    setIpAlias(server.ipAlias ?? '');
    setRam(server.ram);
    setCpu(server.cpu);
    setRuntimeType(server.runtimeType);
    setSelectedNodeId(server.nodeId);
    setSelectedVersion(server.version);
    setSelectedOwnerId(server.owner);
  }, [server.id, server.name, server.port, server.ipAlias, server.ram, server.cpu, server.runtimeType, server.nodeId, server.version, server.owner]);

  const fetchVersions = async () => {
    setLoadingVersions(true);
    try {
      const { data } = await api.get<VersionsResponse>(`/servers/versions`, {
        params: { type: server.serverType },
      });
      setVersions(data.versions);
    } catch {
      setVersions([server.version]);
    } finally {
      setLoadingVersions(false);
    }
  };

  const fetchNodes = async () => {
    setLoadingNodes(true);
    try {
      const { data } = await api.get<NodesResponse>('/nodes');
      setNodes(data.nodes);
    } catch {
      setNodes([]);
    } finally {
      setLoadingNodes(false);
    }
  };

  const fetchOwnerUsers = async () => {
    setLoadingOwnerUsers(true);
    try {
      const { data } = await api.get<UsersResponse>('/system/users');
      setOwnerUsers(data.users);
    } catch {
      setOwnerUsers([]);
    } finally {
      setLoadingOwnerUsers(false);
    }
  };

  useEffect(() => {
    fetchVersions();
  }, [server.serverType]);

  useEffect(() => {
    if (!settings.runtimeLocked) {
      fetchNodes();
    }
  }, [settings.runtimeLocked]);

  const handleSaveGeneral = async () => {
    setSavingGeneral(true);
    setPortAvailable(null);
    try {
      const portNum = Number.parseInt(port, 10);
      if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
        error('Invalid port', 'Port must be between 1 and 65535');
        return;
      }
      const { data } = await api.get<CheckPortResponse>('/servers/check-port', {
        params: { port: portNum, serverId: server.id },
      });
      if (!data.available) {
        error('Port unavailable', 'This port is already in use by another server.');
        return;
      }
      setPortAvailable(true);
      const patch: Record<string, unknown> = { name, port: portNum };
      if (ipAlias !== server.ipAlias) patch.ipAlias = ipAlias;
      await api.put(`/servers/${server.id}`, patch);
      success('Server settings saved');
      onRefresh?.();
    } catch (err) {
      error('Failed to save settings', errorMessage(err));
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleChangeVersion = async () => {
    if (selectedVersion === server.version) {
      info('Version unchanged');
      return;
    }
    setChangingVersion(true);
    try {
      await api.put(`/servers/${server.id}/version`, { version: selectedVersion });
      success('Version updated', 'The server jar will be redownloaded.');
      onRefresh?.();
    } catch (err) {
      error('Failed to change version', errorMessage(err));
    } finally {
      setChangingVersion(false);
    }
  };

  const handleSaveResources = async () => {
    setSavingResources(true);
    try {
      await api.put(`/servers/${server.id}/resources`, { ram, cpu });
      success('Resources updated');
      onRefresh?.();
    } catch (err) {
      error('Failed to update resources', errorMessage(err));
    } finally {
      setSavingResources(false);
    }
  };

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const body: Record<string, unknown> = { runtimeType };
      if (runtimeType !== 'local') body.nodeId = selectedNodeId;
      await api.put(`/servers/${server.id}/migrate-runtime`, body);
      success('Runtime migration started');
      onRefresh?.();
    } catch (err) {
      error('Migration failed', errorMessage(err));
    } finally {
      setMigrating(false);
    }
  };

  const handleReinstall = async () => {
    setReinstallBusy(true);
    try {
      await api.post(`/servers/${server.id}/reinstall`);
      success('Reinstall started');
      setReinstallTarget(false);
      onRefresh?.();
    } catch (err) {
      error('Reinstall failed', errorMessage(err));
    } finally {
      setReinstallBusy(false);
    }
  };

  const handleSuspend = async () => {
    setSuspending(true);
    try {
      await api.put(`/servers/${server.id}/suspend`, { suspended: !server.suspended });
      success(server.suspended ? 'Server unsuspended' : 'Server suspended');
      onRefresh?.();
    } catch (err) {
      error('Failed to update suspension', errorMessage(err));
    } finally {
      setSuspending(false);
    }
  };

  const handleReassignOwner = async () => {
    try {
      await api.put(`/servers/${server.id}/owner`, { ownerId: selectedOwnerId });
      success('Owner reassigned');
      onRefresh?.();
    } catch (err) {
      error('Failed to reassign owner', errorMessage(err));
    }
  };

  const nodeOptions = useMemo(
    () =>
      nodes.map((n) => ({
        value: n.id,
        label: n.name,
        description: `${n.hostname}${n.port ? `:${n.port}` : ''} · ${n.online ? 'Online' : 'Offline'}`,
        disabled: !n.online,
      })),
    [nodes],
  );

  const ownerOptions = useMemo(
    () => ownerUsers.map((u) => ({ value: u.id, label: u.username })),
    [ownerUsers],
  );

  const versionOptions = useMemo(
    () => versions.map((v) => ({ value: v, label: v })),
    [versions],
  );

  const effectiveNodeId = runtimeType === 'local' ? 'local' : selectedNodeId;

  if (loadingVersions) {
    return (
      <div className="flex items-center justify-center p-12">
        <PremiumLoader label="Loading settings" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        <section className="panel-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-theme-400" />
            <h4 className="text-sm font-semibold text-zinc-200">General</h4>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="panel-label">Server name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="panel-input"
              />
            </div>
            <div>
              <label className="panel-label">Port</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={port}
                  onChange={(e) => { setPort(e.target.value); setPortAvailable(null); }}
                  className="panel-input"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setPortChecking(true);
                    setPortAvailable(null);
                    try {
                      const portNum = Number.parseInt(port, 10);
                      const { data } = await api.get<CheckPortResponse>('/servers/check-port', {
                        params: { port: portNum, serverId: server.id },
                      });
                      setPortAvailable(data.available);
                    } catch {
                      setPortAvailable(false);
                    } finally {
                      setPortChecking(false);
                    }
                  }}
                  className="panel-btn-ghost text-xs py-2"
                >
                  {portChecking ? <Spinner /> : 'Check'}
                </button>
              </div>
              {portAvailable === false && (
                <p className="mt-1 text-xs text-red-400">Port is in use.</p>
              )}
              {portAvailable === true && (
                <p className="mt-1 text-xs text-emerald-400">Port is available.</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="panel-label">IP Alias</label>
              <input
                type="text"
                value={ipAlias}
                onChange={(e) => setIpAlias(e.target.value)}
                placeholder="example.com"
                className="panel-input"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveGeneral}
              disabled={savingGeneral || !dirty}
              className="panel-btn-primary gap-1.5 text-xs py-2"
            >
              {savingGeneral && <Spinner />}
              <Save className="h-4 w-4" /> Save
            </button>
          </div>
        </section>

        <section className="panel-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-theme-400" />
            <h4 className="text-sm font-semibold text-zinc-200">Version</h4>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="panel-label">Server version</label>
              <SearchableDropdown
                options={versionOptions}
                value={selectedVersion}
                onChange={setSelectedVersion}
                placeholder="Select version…"
                loading={loadingVersions}
              />
            </div>
            <button
              type="button"
              onClick={handleChangeVersion}
              disabled={changingVersion || selectedVersion === server.version}
              className="panel-btn-primary gap-1.5 text-xs py-2"
            >
              {changingVersion && <Spinner />}
              Change version
            </button>
          </div>
          {selectedVersion !== server.version && (
            <p className="text-xs text-amber-400">Changing the version will redownload the server jar.</p>
          )}
        </section>

        <section className="panel-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-theme-400" />
            <h4 className="text-sm font-semibold text-zinc-200">Resources</h4>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <ResourcesSlider
              label="RAM"
              value={ram}
              min={1}
              max={16}
              step={0.5}
              unit=" GB"
              presets={[1, 2, 4, 8, 12]}
              onChange={setRam}
            />
            <ResourcesSlider
              label="CPU"
              value={cpu}
              min={25}
              max={400}
              step={25}
              unit="%"
              presets={[50, 100, 200]}
              onChange={setCpu}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveResources}
              disabled={savingResources || (ram === server.ram && cpu === server.cpu)}
              className="panel-btn-primary gap-1.5 text-xs py-2"
            >
              {savingResources && <Spinner />}
              <Save className="h-4 w-4" /> Save resources
            </button>
          </div>
        </section>

        {!settings.runtimeLocked && (
          <section className="panel-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-theme-400" />
              <h4 className="text-sm font-semibold text-zinc-200">Runtime</h4>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="panel-label">Runtime type</label>
                <div className="flex rounded-xl border border-white/10 bg-black/40 p-1">
                  {(['docker', 'local'] as const).map((rt) => (
                    <button
                      key={rt}
                      type="button"
                      onClick={() => setRuntimeType(rt)}
                      className={cn(
                        'flex-1 rounded-lg px-3 py-2 text-xs font-medium transition',
                        runtimeType === rt
                          ? 'bg-theme-500/20 text-theme-200'
                          : 'text-zinc-400 hover:text-white',
                      )}
                    >
                      {RUNTIME_LABELS[rt]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="panel-label">Node</label>
                <SearchableDropdown
                  options={nodeOptions}
                  value={effectiveNodeId}
                  onChange={setSelectedNodeId}
                  placeholder="Select node…"
                  loading={loadingNodes}
                  disabled={runtimeType === 'local'}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleMigrate}
                disabled={migrating || (runtimeType === server.runtimeType && effectiveNodeId === server.nodeId)}
                className="panel-btn-primary gap-1.5 text-xs py-2"
              >
                {migrating && <Spinner />}
                Migrate
              </button>
            </div>
          </section>
        )}

        {settings.runtimeLocked && (
          <section className="panel-card p-5 space-y-2">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-zinc-500" />
              <h4 className="text-sm font-semibold text-zinc-200">Runtime</h4>
            </div>
            <p className="text-xs text-zinc-500">
              Runtime is locked by the administrator: <span className="text-theme-400">{RUNTIME_LABELS[server.runtimeType] ?? server.runtimeType}</span>
            </p>
          </section>
        )}

        <section className="panel-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-theme-400" />
            <h4 className="text-sm font-semibold text-zinc-200">Maintenance</h4>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setReinstallTarget(true)}
              className="panel-btn-ghost gap-1.5 text-xs py-2 border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
            >
              <Download className="h-4 w-4" /> Reinstall server
            </button>
            <span className="text-xs text-zinc-500">Stops the server and redownloads the jar.</span>
          </div>
        </section>

        {isAdmin && (
          <section className="panel-card p-5 space-y-4 border-red-500/20">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-red-400" />
              <h4 className="text-sm font-semibold text-red-300">Danger zone</h4>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="panel-label">Suspension</label>
                <button
                  type="button"
                  onClick={handleSuspend}
                  disabled={suspending}
                  className={cn(
                    'panel-btn gap-1.5 text-xs py-2',
                    server.suspended
                      ? 'panel-btn-primary'
                      : 'panel-btn-danger',
                  )}
                >
                  {suspending ? <Spinner /> : server.suspended ? <Play className="h-4 w-4" /> : <StopCircle className="h-4 w-4" />}
                  {server.suspended ? 'Unsuspend server' : 'Suspend server'}
                </button>
              </div>
              <div>
                <label className="panel-label">Reassign owner</label>
                <div className="flex items-center gap-2">
                  <SearchableDropdown
                    options={ownerOptions}
                    value={selectedOwnerId}
                    onChange={setSelectedOwnerId}
                    placeholder="Select owner…"
                    loading={loadingOwnerUsers}
                  />
                  <button
                    type="button"
                    onClick={fetchOwnerUsers}
                    className="panel-btn-ghost text-xs py-2"
                    aria-label="Refresh users"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleReassignOwner}
                  disabled={selectedOwnerId === server.owner}
                  className="panel-btn-primary mt-2 gap-1.5 text-xs py-2"
                >
                  <UserPlus className="h-4 w-4" /> Reassign
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={reinstallTarget}
        onClose={() => setReinstallTarget(false)}
        onConfirm={handleReinstall}
        title="Reinstall server"
        message={
          <span>
            This will stop <strong>{server.name}</strong> and redownload the server jar. All settings and world data are preserved.
          </span>
        }
        confirmLabel="Reinstall"
        danger
        busy={reinstallBusy}
      />
    </div>
  );
}
