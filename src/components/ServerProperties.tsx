import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Settings2, Search, Save, RotateCcw, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { cn } from '@/lib/format';
import type { GameServerView } from '@/types';

interface ServerPropertiesProps {
  server: GameServerView;
  onRefresh?: () => void;
}

interface PropertiesResponse {
  exists: boolean;
  entries: { key: string; value: string }[];
  properties: Record<string, string>;
  portMismatch?: boolean;
  note?: string;
}

const PROPERTY_DOCS: Record<string, { label: string; description: string; group: string; type: 'boolean' | 'number' | 'enum' | 'text'; options?: string[] }> = {
  'spawn-protection': { label: 'Spawn Protection', description: 'Radius (in blocks) protected from modification by non-ops.', group: 'World', type: 'number' },
  'max-tick-time': { label: 'Max Tick Time', description: 'Maximum time (ms) a tick can take before crashing the server.', group: 'Performance', type: 'number' },
  'query.port': { label: 'Query Port', description: 'Port for the query protocol.', group: 'Network', type: 'number' },
  'generator-settings': { label: 'Generator Settings', description: 'Settings for the flat world generator.', group: 'World', type: 'text' },
  'force-gamemode': { label: 'Force Gamemode', description: 'Force players to join in the default gamemode.', group: 'Players', type: 'boolean' },
  'allow-nether': { label: 'Allow Nether', description: 'Allow players to travel to the Nether.', group: 'World', type: 'boolean' },
  'player-idle-timeout': { label: 'Player Idle Timeout', description: 'Kick idle players after this many minutes. 0 to disable.', group: 'Players', type: 'number' },
  'difficulty': { label: 'Difficulty', description: 'World difficulty setting.', group: 'World', type: 'enum', options: ['peaceful', 'easy', 'normal', 'hard'] },
  'network-compression-threshold': { label: 'Network Compression', description: 'Minimum packet size (bytes) to compress. -1 to disable.', group: 'Network', type: 'number' },
  'level-type': { label: 'Level Type', description: 'World generation preset.', group: 'World', type: 'enum', options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified'] },
  'enable-command-block': { label: 'Enable Command Block', description: 'Allow command blocks to function.', group: 'World', type: 'boolean' },
  'max-players': { label: 'Max Players', description: 'Maximum number of players allowed on the server.', group: 'Players', type: 'number' },
  'network-compression': { label: 'Network Compression', description: 'Enable network packet compression.', group: 'Network', type: 'boolean' },
  'max-world-size': { label: 'Max World Size', description: 'Maximum size of the world (blocks from center).', group: 'World', type: 'number' },
  'view-distance': { label: 'View Distance', description: 'Maximum view distance (chunks) sent to players.', group: 'Performance', type: 'number' },
  'simulation-distance': { label: 'Simulation Distance', description: 'Maximum simulation distance (chunks) around the player.', group: 'Performance', type: 'number' },
  'server-port': { label: 'Server Port', description: 'Port the server listens on.', group: 'Network', type: 'number' },
  'enable-rcon': { label: 'Enable RCON', description: 'Enable remote console access.', group: 'Network', type: 'boolean' },
  'level-seed': { label: 'Level Seed', description: 'Seed for world generation. Leave blank for random.', group: 'World', type: 'text' },
  'rcon.password': { label: 'RCON Password', description: 'Password for remote console access.', group: 'Security', type: 'text' },
  'motd': { label: 'MOTD', description: 'Message of the day displayed in the server list.', group: 'Other', type: 'text' },
  'pvp': { label: 'PVP', description: 'Allow player versus player combat.', group: 'Players', type: 'boolean' },
  'enforce-secure-profile': { label: 'Secure Profile', description: 'Require Microsoft account profiles.', group: 'Security', type: 'boolean' },
  'enable-status': { label: 'Enable Status', description: 'Allow status queries from external services.', group: 'Network', type: 'boolean' },
  'hide-online-players': { label: 'Hide Online Players', description: 'Hide the online player count from the server list.', group: 'Players', type: 'boolean' },
  'gamemode': { label: 'Gamemode', description: 'Default gamemode for new players.', group: 'Players', type: 'enum', options: ['survival', 'creative', 'adventure', 'spectator'] },
  'hardcore': { label: 'Hardcore', description: 'Hardcore mode — death bans the player.', group: 'World', type: 'boolean' },
  'enable-whitelist': { label: 'Enable Whitelist', description: 'Only allow whitelisted players to join.', group: 'Security', type: 'boolean' },
  'white-list': { label: 'Whitelist', description: 'Whitelisted players (comma-separated UUIDs).', group: 'Security', type: 'text' },
  'spawn-animals': { label: 'Spawn Animals', description: 'Allow animals to spawn naturally.', group: 'World', type: 'boolean' },
  'spawn-npcs': { label: 'Spawn NPCs', description: 'Allow villagers to spawn.', group: 'World', type: 'boolean' },
  'spawn-monsters': { label: 'Spawn Monsters', description: 'Allow monsters to spawn naturally.', group: 'World', type: 'boolean' },
  'max-build-height': { label: 'Max Build Height', description: 'Maximum height players can build.', group: 'World', type: 'number' },
  'snooper-enabled': { label: 'Snooper Enabled', description: 'Send anonymous usage data to Mojang.', group: 'Other', type: 'boolean' },
  'use-native-transport': { label: 'Native Transport', description: 'Use Linux-native transport for networking.', group: 'Performance', type: 'boolean' },
  'enable-jmx-monitoring': { label: 'Enable JMX', description: 'Expose JMX metrics.', group: 'Other', type: 'boolean' },
  'enable-query': { label: 'Enable Query', description: 'Enable GameSpy4 protocol query.', group: 'Network', type: 'boolean' },
};

const GROUP_ORDER = ['World', 'Players', 'Network', 'Performance', 'Security', 'Other'];

export function ServerProperties({ server, onRefresh }: ServerPropertiesProps) {
  const { success, error } = useToast();
  const { run, busy } = useAsyncAction();

  const [properties, setProperties] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [portMismatch, setPortMismatch] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const fetchProperties = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<PropertiesResponse>(`/servers/${server.id}/properties`);
      setProperties(data.properties);
      setPortMismatch(data.portMismatch ?? false);
      setNote(data.note ?? null);
      setDirty(false);
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load properties'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, [server.id]);

  const handleChange = (key: string, value: string) => {
    setProperties((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.put<PropertiesResponse>(`/servers/${server.id}/properties`, {
        properties,
      });
      setProperties(data.properties);
      setDirty(false);
      success('Properties saved');
      onRefresh?.();
    } catch (err) {
      error('Failed to save properties', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    fetchProperties();
  };

  const knownKeys = Object.keys(PROPERTY_DOCS);
  const unknownKeys = Object.keys(properties).filter((k) => !knownKeys.includes(k));

  const visibleKnown = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return knownKeys;
    return knownKeys.filter((k) => k.toLowerCase().includes(q) || PROPERTY_DOCS[k].label.toLowerCase().includes(q));
  }, [knownKeys, searchQuery]);

  const visibleUnknown = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return unknownKeys;
    return unknownKeys.filter((k) => k.toLowerCase().includes(q));
  }, [unknownKeys, searchQuery]);

  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const key of visibleKnown) {
      const doc = PROPERTY_DOCS[key];
      if (!groups[doc.group]) groups[doc.group] = [];
      groups[doc.group].push(key);
    }
    return groups;
  }, [visibleKnown]);

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm text-red-200">{loadError}</p>
          <button type="button" onClick={fetchProperties} className="panel-btn-ghost text-xs py-1.5">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <PremiumLoader label="Loading properties" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search properties…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="panel-input pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAdvanced}
            onChange={(e) => setShowAdvanced(e.target.checked)}
            className="rounded border-white/20 bg-black/40"
          />
          Advanced / raw
        </label>
        {dirty && (
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={handleDiscard} className="panel-btn-ghost gap-1.5 text-xs py-2">
              <RotateCcw className="h-3.5 w-3.5" /> Discard
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="panel-btn-primary gap-1.5 text-xs py-2"
            >
              {saving && <Spinner />}
              <Save className="h-3.5 w-3.5" /> Save changes
            </button>
          </div>
        )}
      </div>

      {dirty && (
        <p className="text-xs text-amber-400">You have unsaved changes.</p>
      )}

      {note && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {note}
        </div>
      )}

      {portMismatch && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          The configured server port does not match the panel setting. Save to update the panel record.
        </div>
      )}

      {GROUP_ORDER.map((group) => {
        const keys = grouped[group];
        if (!keys || keys.length === 0) return null;
        return (
          <div key={group} className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{group}</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {keys.map((key) => {
                const doc = PROPERTY_DOCS[key];
                const value = properties[key] ?? '';
                return (
                  <div key={key} className="panel-card p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-300">{doc.label}</label>
                      <span className="text-[10px] text-zinc-600">{key}</span>
                    </div>
                    <p className="mb-2 text-xs text-zinc-500">{doc.description}</p>
                    {doc.type === 'boolean' ? (
                      <button
                        type="button"
                        onClick={() => handleChange(key, value === 'true' ? 'false' : 'true')}
                        className={cn(
                          'flex w-full items-center justify-between rounded-xl border px-3 py-2 transition',
                          value === 'true'
                            ? 'border-theme-500/30 bg-theme-500/10'
                            : 'border-white/10 bg-black/40',
                        )}
                      >
                        <span className="text-xs text-zinc-300">{value === 'true' ? 'Enabled' : 'Disabled'}</span>
                        {value === 'true' ? (
                          <ToggleRight className="h-5 w-5 text-theme-400" />
                        ) : (
                          <ToggleLeft className="h-5 w-5 text-zinc-500" />
                        )}
                      </button>
                    ) : doc.type === 'enum' ? (
                      <select
                        value={value}
                        onChange={(e) => handleChange(key, e.target.value)}
                        className="panel-input text-xs py-2"
                      >
                        {doc.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : doc.type === 'number' ? (
                      <input
                        type="number"
                        value={value}
                        onChange={(e) => handleChange(key, e.target.value)}
                        className="panel-input text-xs py-2"
                      />
                    ) : (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => handleChange(key, e.target.value)}
                        className="panel-input text-xs py-2"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {showAdvanced && visibleUnknown.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Unknown properties</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleUnknown.map((key) => (
              <div key={key} className="panel-card p-3">
                <label className="mb-1 block text-xs font-medium text-zinc-300">{key}</label>
                <input
                  type="text"
                  value={properties[key] ?? ''}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="panel-input text-xs py-2"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdvanced && visibleUnknown.length === 0 && (
        <p className="text-xs text-zinc-500">No unknown properties.</p>
      )}
    </div>
  );
}
