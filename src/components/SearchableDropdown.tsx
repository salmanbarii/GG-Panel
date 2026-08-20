import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/format';

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
}

/** Reusable searchable select (version pickers, node pickers, user pickers). */
export function SearchableDropdown({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches',
  disabled,
  loading,
  className,
  maxVisible = 300,
}: {
  options: DropdownOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  maxVisible?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) ||
            option.value.toLowerCase().includes(needle) ||
            option.description?.toLowerCase().includes(needle),
        )
      : options;
    return matches.slice(0, maxVisible);
  }, [options, query, maxVisible]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-left text-sm transition',
          'hover:border-white/20 focus:border-theme-500/60 focus:ring-2 focus:ring-theme-500/20 focus:outline-none',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {loading ? (
            <span className="text-zinc-500">Loading…</span>
          ) : selected ? (
            <span className="text-zinc-100">{selected.label}</span>
          ) : (
            <span className="text-zinc-500">{placeholder}</span>
          )}
        </span>
        {selected?.badge && (
          <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {selected.badge}
          </span>
        )}
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-zinc-500 transition', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-zinc-950/98 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-zinc-500">{emptyMessage}</p>
              )}
              {filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left transition',
                    option.disabled
                      ? 'cursor-not-allowed opacity-40'
                      : 'hover:bg-white/5',
                    option.value === value && 'bg-theme-500/10',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm text-zinc-100">{option.label}</span>
                      {option.badge && (
                        <span className="shrink-0 rounded border border-white/10 bg-white/5 px-1 text-[10px] text-zinc-400">
                          {option.badge}
                        </span>
                      )}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {option.value === value && (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-theme-400" />
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
