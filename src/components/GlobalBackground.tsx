import { useSettings } from '@/context/SettingsContext';
import { cn } from '@/lib/format';

/**
 * Renders the admin-configured background image with the configured blur, or a
 * dark themed gradient fallback. Sits behind everything at z-index 0.
 */
export function GlobalBackground({ className }: { className?: string }) {
  const { settings } = useSettings();
  const image = settings.panelBackgroundImage;
  const blur = Math.max(0, Math.min(40, settings.panelBackgroundBlur ?? 8));

  return (
    <div className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
      {image ? (
        <>
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${image})`, filter: `blur(${blur}px)` }}
          />
          <div className="absolute inset-0 bg-zinc-950/80" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-zinc-950" />
          <div
            className="absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(circle at 15% 10%, color-mix(in oklab, var(--color-theme-600) 22%, transparent), transparent 45%),' +
                'radial-gradient(circle at 85% 80%, color-mix(in oklab, var(--color-theme-500) 14%, transparent), transparent 50%)',
            }}
          />
        </>
      )}

      {/* Subtle grid + vignette for depth */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}

/** Animated aurora gradient used behind the dashboard hero. */
export function AmbientBackground({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div
        className="absolute -top-1/3 -left-1/4 h-[60rem] w-[60rem] animate-float rounded-full opacity-25 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--color-theme-500) 55%, transparent), transparent 65%)',
        }}
      />
      <div
        className="absolute -right-1/4 -bottom-1/3 h-[50rem] w-[50rem] animate-glow rounded-full opacity-20 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--color-theme-400) 45%, transparent), transparent 65%)',
          animationDelay: '1.2s',
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(9,9,11,0.85))]" />
    </div>
  );
}
