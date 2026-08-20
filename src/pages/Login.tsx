import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LockKeyhole, User } from 'lucide-react';
import { GlobalBackground } from '@/components/GlobalBackground';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { settings } = useSettings();
  const { info } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      return;
    }

    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = () => {
    info('Google sign-in requires Firebase configuration in panel settings');
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <GlobalBackground />

      <AnimatePresence>
        {submitting && settings.enableLoginAnimation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <PremiumLoader label="Signing in…" size={80} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="panel-card relative z-10 w-full max-w-sm p-8"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          {settings.panelLogo && (
            <img
              src={settings.panelLogo}
              alt={settings.panelName}
              className="mb-4 h-16 w-16 object-contain"
            />
          )}
          <h1 className="text-2xl font-bold text-white">{settings.panelName}</h1>
          <p className="mt-1 text-sm text-zinc-400">Self-hosted game server management</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="panel-label" htmlFor="login-username">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="login-username"
                className="panel-input pl-9"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                disabled={submitting}
              />
            </div>
          </div>

          <div>
            <label className="panel-label" htmlFor="login-password">Password</label>
            <div className="relative">
              <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="login-password"
                className="panel-input pl-9"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                disabled={submitting}
              />
            </div>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-red-400"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            className="panel-btn-primary w-full"
            disabled={submitting}
          >
            {submitting && <Spinner />}
            Sign in
          </button>
        </form>

        {settings.enableRegistration && (
          <p className="mt-4 text-center text-sm text-zinc-400">
            Need an account?{' '}
            <Link to="/register" className="text-theme-400 transition hover:text-theme-300">
              Register
            </Link>
          </p>
        )}

        {settings.enableGoogleLogin && settings.firebaseApiKey && (
          <button
            type="button"
            className="panel-btn-ghost mt-3 w-full"
            onClick={handleGoogle}
          >
            Continue with Google
          </button>
        )}
      </motion.div>
    </div>
  );
}
