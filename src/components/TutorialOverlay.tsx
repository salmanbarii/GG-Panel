import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useSettings } from '@/context/SettingsContext';
import { cn } from '@/lib/format';

const STEPS = [
  {
    title: 'Create your first server',
    description: 'Use the "New server" button on the Servers page to spin up a Minecraft or generic server in seconds.',
  },
  {
    title: 'Manage files & backups',
    description: 'Browse server files, upload worlds and plugins, and schedule automatic backups directly from the file manager.',
  },
  {
    title: 'Invite teammates with sub-users',
    description: 'Grant scoped permissions to friends so they can manage console, files, or backups without full admin access.',
  },
  {
    title: 'Need help?',
    description: 'Use the built-in AI assistant or check the docs whenever you get stuck.',
  },
];

export function TutorialOverlay() {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!settings.enableTutorial) return;
    if (localStorage.getItem('jtg_tutorial_seen') === '1') return;
    setOpen(true);
  }, [settings.enableTutorial]);

  const close = () => {
    localStorage.setItem('jtg_tutorial_seen', '1');
    setOpen(false);
  };

  if (!open) return null;

  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl"
          >
            <button
              type="button"
              onClick={close}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-white"
              aria-label="Skip tutorial"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-1.5">
                {STEPS.map((_, idx) => (
                  <span
                    key={idx}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition',
                      idx <= step ? 'bg-theme-500' : 'bg-white/10',
                    )}
                  />
                ))}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="mt-6"
                >
                  <h2 className="text-xl font-semibold text-white">{STEPS[step].title}</h2>
                  <p className="mt-2 text-sm text-zinc-400">{STEPS[step].description}</p>
                </motion.div>
              </AnimatePresence>

              <div className="mt-8 flex items-center justify-between">
                <button
                  type="button"
                  onClick={close}
                  className="text-sm text-zinc-400 transition hover:text-white"
                >
                  Skip
                </button>

                <div className="flex items-center gap-2">
                  {step > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep((s) => s - 1)}
                      className="panel-btn-ghost px-3 py-1.5 text-sm"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => (isLast ? close() : setStep((s) => s + 1))}
                    className="panel-btn-primary px-4 py-1.5 text-sm"
                  >
                    {isLast ? 'Finish' : 'Next'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
