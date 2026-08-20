import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, ArrowLeft, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Loaders';
import { SearchableDropdown, type DropdownOption } from '@/components/SearchableDropdown';
import { ResourcesSlider } from '@/components/ResourcesSlider';
import { useSettings } from '@/context/SettingsContext';
import { cn, softwareLabel } from '@/lib/format';
import { SERVER_SOFTWARE } from '@/lib/format';
import type { GameServerView, JavaVersion, MinecraftServerType, RuntimeType, PanelNode } from '@/types';

const STEPS = ['Basics', 'Version', 'Resources', 'Runtime', 'Review'] as const;
const JAVA_OPTIONS: { value: JavaVersion; label: string }[] = [
  { value: '8', label: 'Java 8' },
  { value: '11', label: 'Java 11' },
  { value: '16', label: 'Java 16' },
  { value: '17', label: 'Java 17' },
  { value: '21', label: 'Java 21' },
  { value: 'auto', label: 'Auto' },
];

export function CreateServerWizard({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (server: GameServerView) => void }) {
  const { success, error } = useToast();
  const { run, busy } = useAsyncAction();
  const { settings } = useSettings();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [serverType, setServerType] = useState<MinecraftServerType | undefined>(undefined);
  const [versions, setVersions] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [version, setVersion] = useState('');
  const [javaVersion, setJavaVersion] = useState<JavaVersion>('auto');
  const [ram, setRam] = useState(2);
  const [cpu, setCpu] = useState(100);
  const [port, setPort] = useState(25565);
  const [portAvailable, setPortAvailable] = useState<boolean | null>(null);
  const [portChecking, setPortChecking] = useState(false);
  const [runtimeType, setRuntimeType] = useState<RuntimeType>(settings.defaultRuntime);
  const [nodes, setNodes] = useState<PanelNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [nodeId, setNodeId] = useState('local');

  const portCheckTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const softwareOptions = useMemo<DropdownOption[]>(
    () => SERVER_SOFTWARE.map((s) => ({ value: s.value, label: s.label, description: s.description })),
    [],
  );

  const versionOptions = useMemo<DropdownOption[]>(
    () => versions.map((v) => ({ value: v, label: v })),
    [versions],
  );

  const runtimeOptions = useMemo<DropdownOption[]>(
    () => [
      { value: 'docker', label: 'Docker', description: 'Isolated containers' },
      { value: 'local', label: 'Local', description: 'Runs directly on the host' },
    ],
    [],
  );

  const nodeOptions = useMemo<DropdownOption[]>(
    () => [
      { value: 'local', label: 'Local', description: 'This panel host' },
      ...nodes
        .filter((n) => n.online)
        .map((n) => ({ value: n.id, label: n.name, description: `${n.hostname}${n.port ? `:${n.port}` : ''}` })),
    ],
    [nodes],
  );

  useEffect(() => {
    if (serverType) {
      setLoadingVersions(true);
      setVersion('');
      api
        .get<{ versions: string[] }>('/servers/versions', { params: { serverType } })
        .then((res) => {
          setVersions(res.data.versions);
          if (res.data.versions.length > 0) setVersion(res.data.versions[0]);
        })
        .catch(() => setVersions([]))
        .finally(() => setLoadingVersions(false));
    }
  }, [serverType]);

  useEffect(() => {
    if (settings.runtimeLocked) {
      setRuntimeType(settings.defaultRuntime);
    }
  }, [settings.runtimeLocked, settings.defaultRuntime]);

  useEffect(() => {
    if (!settings.runtimeLocked) {
      setLoadingNodes(true);
      api
        .get<{ nodes: PanelNode[] }>('/nodes')
        .then((res) => {
          setNodes(res.data.nodes);
          const online = res.data.nodes.find((n) => n.online);
          if (online) setNodeId(online.id);
          else setNodeId('local');
        })
        .catch(() => setNodes([]))
        .finally(() => setLoadingNodes(false));
    }
  }, [settings.runtimeLocked]);

  useEffect(() => {
    if (runtimeType === 'local') setNodeId('local');
  }, [runtimeType]);

  useEffect(() => {
    if (step !== 2) return;
    if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
    portCheckTimer.current = setTimeout(async () => {
      setPortChecking(true);
      setPortAvailable(null);
      try {
        const { data } = await api.get<{ available: boolean; reason?: string }>('/servers/check-port', {
          params: { port },
        });
        setPortAvailable(data.available);
      } catch {
        setPortAvailable(false);
      } finally {
        setPortChecking(false);
      }
    }, 500);
    return () => {
      if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
    };
  }, [port, step]);

  const canNext = useMemo(() => {
    if (step === 0) return name.trim().length > 0 && serverType !== undefined;
    if (step === 1) return version.trim().length > 0;
    if (step === 2) return portAvailable === true;
    if (step === 3) return runtimeType !== undefined && nodeId !== undefined;
    return true;
  }, [step, name, serverType, version, portAvailable, runtimeType, nodeId]);

  const handleNext = () => {
    if (step < 4 && canNext) setStep((s) => s + 1);
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && step < 4 && canNext) {
      e.preventDefault();
      handleNext();
    }
  };

  const reset = () => {
    setStep(0);
    setName('');
    setServerType(undefined);
    setVersions([]);
    setVersion('');
    setJavaVersion('auto');
    setRam(2);
    setCpu(100);
    setPort(25565);
    setPortAvailable(null);
    setRuntimeType(settings.defaultRuntime);
    setNodes([]);
    setNodeId('local');
  };

  const handleCreate = async () => {
    if (!name.trim() || portAvailable !== true) return;
    await run(
      async () => {
        const { data } = await api.post<{ server: GameServerView; warnings?: string[] }>('/servers', {
          name: name.trim(),
          type: 'minecraft',
          serverType,
          version,
          javaVersion,
          ram,
          cpu,
          port,
          runtimeType,
          nodeId,
        });
        return data;
      },
      {
        successMessage: 'Server created',
        onDone: (data) => {
          onCreated?.(data.server);
          onClose();
          reset();
        },
      },
    );
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-5">
            <div>
              <label className="panel-label">Server name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My awesome server"
                className="panel-input"
                autoFocus
              />
            </div>
            <div>
              <label className="panel-label">Server software</label>
              <SearchableDropdown
                options={softwareOptions}
                value={serverType}
                onChange={(v) => setServerType(v as MinecraftServerType)}
                placeholder="Select software..."
                searchPlaceholder="Search software..."
              />
            </div>
          </div>
        );
      case 1:
        return (
          <div className="space-y-5">
            <div>
              <label className="panel-label">Version</label>
              <SearchableDropdown
                options={versionOptions}
                value={version}
                onChange={setVersion}
                placeholder="Select version..."
                loading={loadingVersions}
              />
            </div>
            <div>
              <label className="panel-label">Java version</label>
              <select
                value={javaVersion}
                onChange={(e) => setJavaVersion(e.target.value as JavaVersion)}
                className="panel-input"
              >
                {JAVA_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-6">
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
                step={5}
                unit="%"
                presets={[50, 100, 200]}
                onChange={setCpu}
              />
            </div>
            <div>
              <label className="panel-label">Port</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={port}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    setPort(Number.isNaN(v) ? 1024 : Math.max(1024, Math.min(65535, v)));
                    setPortAvailable(null);
                  }}
                  className="panel-input w-32"
                />
                {portChecking && <Spinner className="h-4 w-4 text-zinc-500" />}
              </div>
              <div className="mt-1.5 h-5">
                {portAvailable === true && <p className="text-xs text-emerald-400">Port is available.</p>}
                {portAvailable === false && <p className="text-xs text-red-400">Port is already in use.</p>}
              </div>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-5">
            {settings.runtimeLocked ? (
              <div className="panel-card border-white/5 bg-white/5 p-4">
                <p className="text-xs text-zinc-500">Runtime is locked by the administrator</p>
                <p className="mt-1 text-sm font-medium text-theme-400">{runtimeType}</p>
              </div>
            ) : (
              <div>
                <label className="panel-label">Runtime</label>
                <SearchableDropdown
                  options={runtimeOptions}
                  value={runtimeType}
                  onChange={(v) => setRuntimeType(v as RuntimeType)}
                  placeholder="Select runtime..."
                />
              </div>
            )}
            <div>
              <label className="panel-label">Node</label>
              <SearchableDropdown
                options={nodeOptions}
                value={nodeId}
                onChange={setNodeId}
                placeholder="Select node..."
                loading={loadingNodes}
              />
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-zinc-500">Name</p>
                <p className="font-medium text-white">{name}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Software</p>
                <p className="font-medium text-white">{softwareLabel((serverType ?? 'vanilla') as MinecraftServerType)} {version}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Java</p>
                <p className="font-medium text-white">{javaVersion}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Resources</p>
                <p className="font-medium text-white">{ram} GB RAM / {cpu}% CPU</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Port</p>
                <p className="font-medium text-white">:{port}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Runtime</p>
                <p className="font-medium text-white">{runtimeType} / {nodeId}</p>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create server"
      description={
        <div className="flex items-center justify-center gap-3 pt-1">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={cn('h-1.5 w-1.5 rounded-full', i <= step ? 'bg-theme-500' : 'bg-white/10')} />
              <span className={cn('text-[11px] font-medium', i <= step ? 'text-theme-400' : 'text-zinc-600')}>{label}</span>
            </div>
          ))}
        </div>
      }
      size="lg"
      footer={
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={step === 0}
            className="panel-btn-ghost gap-1.5 text-xs"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={!canNext}
              className="panel-btn-primary gap-1.5 text-xs"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy || !name.trim() || portAvailable !== true}
              className="panel-btn-primary gap-1.5 text-xs"
            >
              {busy && <Spinner />}
              <Plus className="h-4 w-4" /> Create server
            </button>
          )}
        </div>
      }
    >
      <div onKeyDown={handleKeyDown}>
        {renderStep()}
      </div>
    </Modal>
  );
}
