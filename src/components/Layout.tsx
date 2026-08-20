import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import { Menu, Search, Bell, User } from 'lucide-react';
import { GlobalBackground } from '@/components/GlobalBackground';
import { Sidebar } from '@/components/Sidebar';
import { GlobalSearchModal } from '@/components/GlobalSearchModal';
import { NotificationsDropdown } from '@/components/NotificationsDropdown';
import { TutorialOverlay } from '@/components/TutorialOverlay';
import { SystemUpdateListener } from '@/components/SystemUpdateListener';
import { UploadProgress } from '@/components/UploadProgress';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/format';

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const avatarSrc = user?.avatar;

  const handleToggleSearch = useCallback(() => {
    setSearchOpen((v) => !v);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <GlobalBackground />

      <Sidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onNavigate={() => setMobileOpen(false)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/5 bg-zinc-950/70 px-4 py-3 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Toggle menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={handleToggleSearch}
            className={cn(
              'flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-400 transition',
              'hover:border-theme-500/30 hover:bg-white/10 hover:text-zinc-200',
            )}
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Search servers…</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
              ⌘K
            </kbd>
          </button>

          <div className="flex-1" />

          <NotificationsDropdown />

          <UploadProgress />

          <button
            type="button"
            onClick={() => navigate('/account')}
            className="rounded-lg p-1 text-zinc-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Account"
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <User className="h-5 w-5" />
            )}
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <TutorialOverlay />
      <SystemUpdateListener />
    </div>
  );
}
