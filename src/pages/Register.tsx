import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Mail, LockKeyhole } from 'lucide-react';
import { GlobalBackground } from '@/components/GlobalBackground';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const { settings } = useSettings();
  const { success } = useToast();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!settings.enableRegistration) {
      navigate('/login', { replace: true });
    }
  }, [settings.enableRegistration, navigate]);

  if (!settings.enableRegistration) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }

    setSubmitting(true);
    try {
      await register({ username: username.trim(), password, email: email.trim() || undefined });
      success('Account created');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Registration failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <GlobalBackground />

      {submitting && settings.enableLoginAnimation && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <PremiumLoader label="Creating account…" size={80} />
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="panel-card relative z-10 w-full max-w-sm p-8"
      >
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">Create account</h1>
          <p className="mt-1 text-sm text-zinc-400">Join {settings.panelName}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="panel-label" htmlFor="reg-username">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="reg-username"
                className="panel-input pl-9"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                autoComplete="username"
                disabled={submitting}
              />
            </div>
          </div>

          <div>
            <label className="panel-label" htmlFor="reg-email">Email (optional)</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="reg-email"
                className="panel-input pl-9"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={submitting}
              />
            </div>
          </div>

          <div>
            <label className="panel-label" htmlFor="reg-password">Password</label>
            <div className="relative">
              <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="reg-password"
                className="panel-input pl-9"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                autoComplete="new-password"
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
            Create account
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-400">
          Already have an account?{' '}
          <Link to="/login" className="text-theme-400 transition hover:text-theme-300">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
