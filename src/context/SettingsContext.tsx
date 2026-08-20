import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PanelSettings } from '@/types';
import { api } from '@/lib/api';

/**
 * Panel-wide settings, fetched from the public `/api/settings` endpoint so the
 * login screen can be branded before authentication. Also applies the theme
 * class to <html> so every `var(--color-theme-*)` follows the admin's choice.
 */

const FALLBACK: PanelSettings = {
  panelName: 'GG Panel',
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
  defaultRuntime: 'docker',
  runtimeLocked: false,
  isDev: false,
};

interface SettingsContextValue {
  settings: PanelSettings;
  loading: boolean;
  reload: () => Promise<void>;
  /** Admin save — patches settings.json and updates local state. */
  saveSettings: (patch: Partial<PanelSettings>) => Promise<PanelSettings>;
  /** Optimistic local override used by the settings preview. */
  previewSettings: (patch: Partial<PanelSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const THEMES = ['red', 'blue', 'green', 'purple', 'orange', 'cyan', 'pink', 'zinc'];

function applyTheme(theme: string): void {
  const root = document.documentElement;
  for (const name of THEMES) root.classList.remove(`theme-${name}`);
  root.classList.add(`theme-${THEMES.includes(theme) ? theme : 'red'}`);
  root.classList.add('dark');
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PanelSettings>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get<PanelSettings>('/settings');
      setSettings({ ...FALLBACK, ...data });
    } catch {
      // Keep the fallback branding so the login page still renders.
      setSettings(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    applyTheme(settings.theme);
    document.title = settings.panelName || 'GG Panel';
  }, [settings.theme, settings.panelName]);

  const saveSettings = useCallback(async (patch: Partial<PanelSettings>) => {
    const { data } = await api.put<{ settings: PanelSettings }>('/system/settings', patch);
    setSettings({ ...FALLBACK, ...data.settings });
    return data.settings;
  }, []);

  const previewSettings = useCallback((patch: Partial<PanelSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, loading, reload, saveSettings, previewSettings }),
    [settings, loading, reload, saveSettings, previewSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
