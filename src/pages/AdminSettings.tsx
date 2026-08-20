import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Settings, Upload, RotateCw } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { ImageCropper } from '@/components/ImageCropper';
import { ResourcesSlider } from '@/components/ResourcesSlider';
import { SearchableDropdown, type DropdownOption } from '@/components/SearchableDropdown';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { useSettings } from '@/context/SettingsContext';
import { useToast, useAsyncAction } from '@/context/ToastContext';
import { cn } from '@/lib/format';
import type { PanelSettings, ThemeFamily } from '@/types';

const THEME_OPTIONS: DropdownOption[] = [
  { value: 'red', label: 'Red' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'purple', label: 'Purple' },
  { value: 'orange', label: 'Orange' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'pink', label: 'Pink' },
  { value: 'zinc', label: 'Zinc' },
];

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-white/10 transition',
        checked ? 'bg-theme-600' : 'bg-white/10',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-md transition',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}

export default function AdminSettingsPage() {
  const { settings, loading: settingsLoading, saveSettings, previewSettings } = useSettings();
  const { success, error: showError } = useToast();
  const { run, busy } = useAsyncAction();

  const [draft, setDraft] = useState<PanelSettings>(settings);
  const [lastSaved, setLastSaved] = useState<PanelSettings>(settings);
  const [logoCropperOpen, setLogoCropperOpen] = useState(false);
  const [bgCropperOpen, setBgCropperOpen] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
    setLastSaved(settings);
    setLogoPreview(settings.panelLogo || null);
    setBgPreview(settings.panelBackgroundImage || null);
  }, [settings]);

  useEffect(() => {
    previewSettings(draft);
  }, [draft, previewSettings]);

  const dirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(lastSaved);
  }, [draft, lastSaved]);

  const handleSave = useCallback(async () => {
    await run(
      async () => {
        const saved = await saveSettings(draft);
        setDraft(saved);
        setLastSaved(saved);
        setLogoPreview(saved.panelLogo || null);
        setBgPreview(saved.panelBackgroundImage || null);
        success('Settings saved');
      },
      { errorMessage: 'Failed to save settings' },
    );
  }, [run, draft, saveSettings, success]);

  const handleReset = useCallback(() => {
    setDraft(lastSaved);
    setLogoPreview(lastSaved.panelLogo || null);
    setBgPreview(lastSaved.panelBackgroundImage || null);
  }, [lastSaved]);

  const updateDraft = <K extends keyof PanelSettings>(key: K, value: PanelSettings[K]) => {
    setDraft((curr) => ({ ...curr, [key]: value }));
  };

  const handleLogoCropped = useCallback(
    async (dataUrl: string) => {
      setLogoPreview(dataUrl);
      updateDraft('panelLogo', dataUrl);
    },
    [updateDraft],
  );

  const handleBgCropped = useCallback(
    async (dataUrl: string) => {
      setBgPreview(dataUrl);
      updateDraft('panelBackgroundImage', dataUrl);
    },
    [updateDraft],
  );

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <PremiumLoader label="Loading settings…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Panel Settings"
        icon={<Settings className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={!dirty || busy}
              className="panel-btn-ghost gap-1.5 text-xs"
            >
              <RotateCw className="h-4 w-4" /> Reset
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!dirty || busy}
              className="panel-btn-primary gap-1.5 text-sm"
            >
              {busy && <Spinner />} Save changes
            </button>
          </div>
        }
      />

      <div className="mt-6 space-y-6">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card p-5 space-y-4"
        >
          <h3 className="text-base font-semibold text-white">Branding</h3>
          <div>
            <label className="panel-label" htmlFor="panel-name">Panel name</label>
            <input
              id="panel-name"
              className="panel-input"
              value={draft.panelName}
              onChange={(e) => updateDraft('panelName', e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="panel-label">Panel logo</label>
              <button
                type="button"
                onClick={() => setLogoCropperOpen(true)}
                className="panel-btn-ghost gap-1.5 text-xs"
              >
                <Upload className="h-4 w-4" /> Upload logo
              </button>
              {logoPreview && (
                <img
                  src={logoPreview}
                  alt="Logo preview"
                  className="mt-2 h-10 w-10 rounded-lg object-cover border border-white/10"
                />
              )}
            </div>
            <div>
              <label className="panel-label">Background image</label>
              <button
                type="button"
                onClick={() => setBgCropperOpen(true)}
                className="panel-btn-ghost gap-1.5 text-xs"
              >
                <Upload className="h-4 w-4" /> Upload background
              </button>
              {bgPreview && (
                <img
                  src={bgPreview}
                  alt="Background preview"
                  className="mt-2 h-16 w-32 rounded-lg object-cover border border-white/10"
                />
              )}
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="panel-card p-5 space-y-4"
        >
          <h3 className="text-base font-semibold text-white">Appearance</h3>
          <div>
            <label className="panel-label" htmlFor="theme-select">Theme</label>
            <SearchableDropdown
              options={THEME_OPTIONS}
              value={draft.theme}
              onChange={(value) => updateDraft('theme', value as ThemeFamily)}
              placeholder="Select theme…"
            />
          </div>
          <ResourcesSlider
            label="Background blur"
            value={draft.panelBackgroundBlur}
            min={0}
            max={40}
            unit="px"
            onChange={(value) => updateDraft('panelBackgroundBlur', value)}
          />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="panel-card p-5 space-y-4"
        >
          <h3 className="text-base font-semibold text-white">Behaviour</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Registration</p>
                <p className="text-xs text-zinc-500">Allow new users to register</p>
              </div>
              <Switch
                checked={draft.enableRegistration}
                onChange={(value) => updateDraft('enableRegistration', value)}
                label="Enable registration"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Playit</p>
                <p className="text-xs text-zinc-500">Enable Playit.gg tunneling</p>
              </div>
              <Switch
                checked={draft.enablePlayit}
                onChange={(value) => updateDraft('enablePlayit', value)}
                label="Enable Playit"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Tutorial</p>
                <p className="text-xs text-zinc-500">Show onboarding tutorial</p>
              </div>
              <Switch
                checked={draft.enableTutorial}
                onChange={(value) => updateDraft('enableTutorial', value)}
                label="Enable tutorial"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Login animation</p>
                <p className="text-xs text-zinc-500">Show animated login screen</p>
              </div>
              <Switch
                checked={draft.enableLoginAnimation}
                onChange={(value) => updateDraft('enableLoginAnimation', value)}
                label="Enable login animation"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Runtime lock</p>
                <p className="text-xs text-zinc-500">Prevent users from changing runtime</p>
              </div>
              <Switch
                checked={draft.runtimeLocked}
                onChange={(value) => updateDraft('runtimeLocked', value)}
                label="Lock runtime"
              />
            </div>
            <div>
              <label className="panel-label" htmlFor="default-runtime">Default runtime</label>
              <select
                id="default-runtime"
                className="panel-input"
                value={draft.defaultRuntime}
                onChange={(e) => updateDraft('defaultRuntime', e.target.value as 'docker' | 'local')}
                disabled={draft.runtimeLocked}
              >
                <option value="docker">Docker</option>
                <option value="local">Local</option>
              </select>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="panel-card p-5"
        >
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-white">
              Firebase configuration
              <span className="transition group-open:rotate-180">▾</span>
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                ['firebaseApiKey', 'API key'],
                ['firebaseAuthDomain', 'Auth domain'],
                ['firebaseProjectId', 'Project ID'],
                ['firebaseAppId', 'App ID'],
                ['firebaseMessagingSenderId', 'Messaging sender ID'],
                ['firebaseStorageBucket', 'Storage bucket'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="panel-label" htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    className="panel-input"
                    value={draft[key as keyof PanelSettings] as string}
                    onChange={(e) => updateDraft(key as keyof PanelSettings, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </details>
        </motion.section>
      </div>

      <ImageCropper
        open={logoCropperOpen}
        onClose={() => setLogoCropperOpen(false)}
        onCropped={handleLogoCropped}
        title="Crop logo"
        aspect={1}
        round
        maxSize={256}
        initialImage={logoPreview || undefined}
      />
      <ImageCropper
        open={bgCropperOpen}
        onClose={() => setBgCropperOpen(false)}
        onCropped={handleBgCropped}
        title="Crop background"
        aspect={16 / 9}
        maxSize={1280}
        initialImage={bgPreview || undefined}
      />
    </div>
  );
}
