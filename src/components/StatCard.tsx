import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn, percent } from '@/lib/format';

/** Dashboard stat card with an inline SVG sparkline. */
export function StatCard({
  label,
  value,
  unit,
  icon,
  history,
  trend,
  footer,
  accent = 'theme',
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  history?: number[];
  trend?: number;
  footer?: ReactNode;
  accent?: 'theme' | 'emerald' | 'sky' | 'amber';
  className?: string;
}) {
  const accents = {
    theme: 'text-theme-400 border-theme-500/30 bg-theme-500/10',
    emerald: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    sky: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
    amber: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  } as const;

  const strokes = {
    theme: 'var(--color-theme-500)',
    emerald: '#34d399',
    sky: '#38bdf8',
    amber: '#fbbf24',
  } as const;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        'panel-card group relative overflow-hidden p-4 transition hover:border-white/20',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium tracking-[0.14em] text-zinc-500 uppercase">
            {label}
          </p>
          <p className="mt-1.5 flex items-baseline gap-1 text-2xl font-bold text-white">
            {value}
            {unit && <span className="text-sm font-medium text-zinc-500">{unit}</span>}
          </p>
        </div>
        {icon && (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
              accents[accent],
            )}
          >
            {icon}
          </span>
        )}
      </div>

      {history && history.length > 1 && (
        <Sparkline points={history} stroke={strokes[accent]} className="mt-3" />
      )}

      <div className="mt-2 flex items-center justify-between text-xs">
        {footer && <span className="truncate text-zinc-500">{footer}</span>}
        {typeof trend === 'number' && trend !== 0 && (
          <span
            className={cn(
              'flex items-center gap-1 font-medium',
              trend > 0 ? 'text-emerald-400' : 'text-red-400',
            )}
          >
            {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(trend).toFixed(0)}%
          </span>
        )}
      </div>

      <span className="pointer-events-none absolute -right-8 -bottom-10 h-24 w-24 rounded-full bg-theme-500/5 blur-2xl transition group-hover:bg-theme-500/10" />
    </motion.div>
  );
}

/** Minimal dependency-free sparkline. */
export function Sparkline({
  points,
  stroke = 'var(--color-theme-500)',
  height = 34,
  className,
}: {
  points: number[];
  stroke?: string;
  height?: number;
  className?: string;
}) {
  if (points.length < 2) return null;

  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const width = 100;

  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point - min) / range) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const gradientId = `spark-${stroke.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-9 w-full', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,${height} ${coords.join(' ')} ${width},${height}`}
        fill={`url(#${gradientId})`}
        stroke="none"
      />
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Labelled usage bar (RAM/CPU/disk) used on node and server cards. */
export function UsageBar({
  label,
  used,
  total,
  unit = '',
  formatValue,
  className,
}: {
  label: string;
  used: number;
  total: number;
  unit?: string;
  formatValue?: (used: number, total: number) => string;
  className?: string;
}) {
  const pct = percent(used, total);
  const tone =
    pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : pct > 50 ? 'bg-theme-500' : 'bg-emerald-500';

  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-500">{label}</span>
        <span className="font-medium text-zinc-300">
          {formatValue
            ? formatValue(used, total)
            : `${used.toFixed(used < 10 ? 1 : 0)}${unit} / ${total.toFixed(total < 10 ? 1 : 0)}${unit}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <motion.div
          className={cn('h-full rounded-full', tone)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
