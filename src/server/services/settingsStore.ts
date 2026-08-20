import type { PanelSettings } from '../../types/index.js';
import { FILES, readJSON, updateJSON } from '../utils/jsonStore.js';
import { config } from '../utils/config.js';

/** settings.json access. Missing keys always fall back to the defaults below. */

export function defaultSettings(): PanelSettings {
  return {
    panelName: 'JTG Panel',
    panelLogo: '',
    panelBackgroundImage: '',
    panelBackgroundBlur: 8,
    enablePlayit: false,
    enableTutorial: true,
    enableLoginAnimation: true,
    enableRegistration: true,
    theme: 'red',
    enableGoogleLogin: false,
    firebaseApiKey: '',
    firebaseAuthDomain: '',
    firebaseProjectId: '',
    firebaseAppId: '',
    firebaseMessagingSenderId: '',
    firebaseStorageBucket: '',
    defaultRuntime: config.defaultRuntime,
    runtimeLocked: config.runtimeLocked,
    isDev: config.isDev,
  };
}

/** Keys that are derived from env/runtime and are never persisted. */
const DERIVED_KEYS: (keyof PanelSettings)[] = ['isDev', 'panelVersion', 'dockerAvailable', 'sftpPort'];

export async function getSettings(): Promise<PanelSettings> {
  const stored = await readJSON<Partial<PanelSettings>>(FILES.settings, {});
  return {
    ...defaultSettings(),
    ...stored,
    isDev: config.isDev,
    panelVersion: config.panelVersion,
    sftpPort: config.sftpPort,
  };
}

export async function saveSettings(patch: Partial<PanelSettings>): Promise<PanelSettings> {
  const clean: Partial<PanelSettings> = { ...patch };
  for (const key of DERIVED_KEYS) delete clean[key];

  await updateJSON<Partial<PanelSettings>>(FILES.settings, {}, (current) => ({
    ...current,
    ...clean,
  }));
  return getSettings();
}

/** Runtime the panel should use for a new server, honouring the admin lock. */
export async function resolveRuntimeChoice(requested?: string): Promise<'docker' | 'local'> {
  const settings = await getSettings();
  if (settings.runtimeLocked) return settings.defaultRuntime;
  if (requested === 'local' || requested === 'docker') return requested;
  return settings.defaultRuntime;
}
