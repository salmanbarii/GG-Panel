import { motion } from 'framer-motion';
import { cn } from '@/lib/format';

/** Fancy multi-ring loader used on the dashboard and first paint. */
export function PremiumLoader({
  label,
  size = 72,
  className,
}: {
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-theme-500/20 border-t-theme-500"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.1, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        />
        <motion.span
          className="absolute inset-2 rounded-full border-2 border-theme-400/10 border-b-theme-400"
          animate={{ rotate: -360 }}
          transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        />
        <motion.span
          className="absolute inset-[38%] rounded-full bg-theme-500"
          animate={{ scale: [1, 1.35, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        />
      </div>
      {label && (
        <motion.p
          className="text-xs font-medium tracking-[0.2em] text-zinc-500 uppercase"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
        >
          {label}
        </motion.p>
      )}
    </div>
  );
}

/** Full-screen blocking overlay for destructive/long server actions. */
export function LoadingOverlay({
  show,
  title = 'Working…',
  message,
}: {
  show: boolean;
  title?: string;
  message?: string;
}) {
  if (!show) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-6 bg-black/70 backdrop-blur-sm"
    >
      <PremiumLoader size={84} />
      <div className="text-center">
        <p className="text-lg font-semibold text-white">{title}</p>
        {message && <p className="mt-1 max-w-sm text-sm text-zinc-400">{message}</p>}
      </div>
    </motion.div>
  );
}

/** Inline spinner for buttons. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white',
        className,
      )}
    />
  );
}
