import { useId } from 'react';
import { cn } from '@/lib/format';

/**
 * Stylised RAM/CPU slider with a live readout and quick preset buttons.
 * Used by the create wizard and the per-server settings tab.
 */
export function ResourcesSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  presets,
  hint,
  disabled,
  onChange,
  formatValue,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  presets?: number[];
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  className?: string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const display = formatValue ? formatValue(value) : `${value}${unit ?? ''}`;

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="panel-label mb-0">
          {label}
        </label>
        <span className="rounded-lg border border-theme-500/30 bg-theme-500/10 px-2.5 py-1 font-mono text-sm font-semibold text-theme-300">
          {display}
        </span>
      </div>

      <div className="relative">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="peer relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed
            [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white
            [&::-moz-range-thumb]:bg-theme-500
            [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
            [&::-webkit-slider-thumb]:bg-theme-500 [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:shadow-theme-500/40"
        />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-theme-600 to-theme-400"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-zinc-600">
          {min}
          {unit}
        </span>
        {presets && presets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {presets
              .filter((preset) => preset >= min && preset <= max)
              .map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(preset)}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-[11px] font-medium transition',
                    value === preset
                      ? 'border-theme-500/50 bg-theme-500/20 text-theme-200'
                      : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white',
                  )}
                >
                  {formatValue ? formatValue(preset) : `${preset}${unit ?? ''}`}
                </button>
              ))}
          </div>
        )}
        <span className="font-mono text-[11px] text-zinc-600">
          {max}
          {unit}
        </span>
      </div>

      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
