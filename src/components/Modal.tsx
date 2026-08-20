import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/format';
import { Spinner } from './Loaders';

/** Glass modal shell used by every dialog in the panel. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  } as const;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className={cn(
              'relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl',
              widths[size],
            )}
          >
            <div className="flex items-start gap-3 border-b border-white/10 p-5">
              {icon && (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-theme-500/30 bg-theme-500/10 text-theme-400">
                  {icon}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-white">{title}</h2>
                {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {children && <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>}
            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-white/10 bg-black/30 p-4">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Confirmation dialog with an optional "type the name to confirm" guard. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  requireText,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  requireText?: string;
}) {
  const [typed, setTyped] = useState('');

  // Clear the guard text whenever the dialog is reopened.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const blocked = Boolean(requireText) && typed.trim() !== requireText;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      icon={danger ? <AlertTriangle className="h-4 w-4" /> : undefined}
      footer={
        <>
          <button type="button" className="panel-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'panel-btn-danger' : 'panel-btn-primary'}
            onClick={onConfirm}
            disabled={busy || blocked}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && <div className="text-sm text-zinc-300">{message}</div>}
      {requireText && (
        <div className="mt-4">
          <label className="panel-label">
            Type <span className="font-mono text-theme-400">{requireText}</span> to confirm
          </label>
          <input
            className="panel-input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={requireText}
            autoComplete="off"
          />
        </div>
      )}
    </Modal>
  );
}
