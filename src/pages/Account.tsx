import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Mail, LockKeyhole, LogOut, Upload } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { ImageCropper } from '@/components/ImageCropper';
import { PremiumLoader, Spinner } from '@/components/Loaders';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useAsyncAction } from '@/context/ToastContext';

export default function AccountPage() {
  const navigate = useNavigate();
  const { user, updateUser, logout } = useAuth();
  const { settings } = useSettings();
  const { run, busy } = useAsyncAction();

  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [cropperOpen, setCropperOpen] = useState(false);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setEmail(user.email ?? '');
    }
  }, [user]);

  const handleAvatarCropped = useCallback(
    async (dataUrl: string) => {
      await run(() => updateUser({ avatar: dataUrl }), { successMessage: 'Avatar updated' });
    },
    [run, updateUser],
  );

  const handleUsernameSave = useCallback(async () => {
    if (!username.trim() || username === user?.username) return;
    await run(
      () => updateUser({ username: username.trim() }),
      { successMessage: 'Username updated' },
    );
  }, [run, updateUser, username, user]);

  const handleEmailSave = useCallback(async () => {
    const trimmed = email.trim();
    if (trimmed === (user?.email ?? '')) return;
    await run(
      () => updateUser({ email: trimmed || undefined }),
      { successMessage: 'Email updated' },
    );
  }, [run, updateUser, email, user]);

  const handlePasswordChange = useCallback(async () => {
    setPasswordError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    await run(
      () => updateUser({ currentPassword, password: newPassword }),
      { successMessage: 'Password updated' },
    );

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, [run, updateUser, currentPassword, newPassword, confirmPassword]);

  const handleLogout = useCallback(async () => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  if (!user) {
    return (
      <div className="flex items-center justify-center py-20">
        <PremiumLoader label="Loading account…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Account" />

      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card p-6"
        >
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="relative">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.username}
                  className="h-20 w-20 rounded-full object-cover border-2 border-theme-500/30"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-theme-500/30 bg-theme-500/10 text-theme-400">
                  <User className="h-8 w-8" />
                </div>
              )}
              <button
                type="button"
                className="absolute -bottom-1 -right-1 rounded-full border border-theme-500/30 bg-theme-500/10 p-1.5 text-theme-400 transition hover:bg-theme-500/20"
                onClick={() => setCropperOpen(true)}
                aria-label="Edit avatar"
              >
                <Upload className="h-3 w-3" />
              </button>
            </div>

            <div className="flex-1 space-y-4">
              <div>
                <label className="panel-label" htmlFor="account-username">Username</label>
                <input
                  id="account-username"
                  className="panel-input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={handleUsernameSave}
                />
              </div>
              <div>
                <label className="panel-label" htmlFor="account-email">Email</label>
                <input
                  id="account-email"
                  className="panel-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={handleEmailSave}
                />
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="panel-card p-6"
        >
          <h3 className="mb-4 text-lg font-semibold text-white">Change password</h3>
          <div className="space-y-4">
            <div>
              <label className="panel-label" htmlFor="current-password">Current password</label>
              <input
                id="current-password"
                className="panel-input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label className="panel-label" htmlFor="new-password">New password</label>
              <input
                id="new-password"
                className="panel-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label className="panel-label" htmlFor="confirm-password">Confirm new password</label>
              <input
                id="confirm-password"
                className="panel-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={busy}
              />
            </div>

            {passwordError && <p className="text-sm text-red-400">{passwordError}</p>}

            <button
              type="button"
              className="panel-btn-primary"
              disabled={busy}
              onClick={handlePasswordChange}
            >
              {busy && <Spinner />}
              Update password
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex justify-end"
        >
          <button
            type="button"
            className="panel-btn-danger"
            onClick={handleLogout}
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </motion.div>
      </div>

      <ImageCropper
        open={cropperOpen}
        onClose={() => setCropperOpen(false)}
        onCropped={handleAvatarCropped}
        title="Edit avatar"
        aspect={1}
        round
        maxSize={256}
        initialImage={user.avatar}
      />
    </div>
  );
}
