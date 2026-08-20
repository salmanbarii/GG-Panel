import { useRef, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Server,
  Network,
  KeyRound,
  Settings,
  ShieldAlert,
  User,
  LogOut,
  Boxes,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { cn } from '@/lib/format';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, admin: false },
  { to: '/servers', label: 'Servers', icon: Server, admin: false },
  { to: '/nodes', label: 'Nodes', icon: Network, admin: false },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound, admin: false },
  { to: '/admin/settings', label: 'Admin Settings', icon: Settings, admin: true },
  { to: '/admin/servers', label: 'Admin Servers', icon: ShieldAlert, admin: true },
  { to: '/account', label: 'Account', icon: User, admin: false },
] as const;

export function Sidebar({
  open,
  onClose,
  onNavigate,
}: {
  open?: boolean;
  onClose?: () => void;
  onNavigate?: () => void;
}) {
  const { user, isAdmin, logout } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const avatarSrc = user?.avatar;

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  const navItems = NAV_ITEMS.filter((item) => !item.admin || isAdmin);

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-5">
        {settings.panelLogo ? (
          <img
            src={settings.panelLogo}
            alt={settings.panelName}
            className="h-8 w-8 rounded-lg object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-theme-500/30 bg-theme-500/10 text-theme-400">
            <Boxes className="h-5 w-5" />
          </span>
        )}
        <span className="truncate text-sm font-semibold text-white">{settings.panelName}</span>
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'panel-btn-active text-white' : 'panel-btn-ghost text-zinc-300 hover:text-white',
              )
            }
          >
            <item.icon className="h-4.5 w-4.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={user?.username ?? 'User'}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400">
              <User className="h-4 w-4" />
            </span>
          )}
          <span className="flex-1 truncate text-sm text-zinc-200">{user?.username}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-white"
            aria-label="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop static sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-white/10 md:bg-zinc-950/80 md:backdrop-blur-xl">
        {content}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm md:hidden"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 left-0 z-50 w-64 border-r border-white/10 bg-zinc-950/95 backdrop-blur-xl md:hidden"
            >
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
