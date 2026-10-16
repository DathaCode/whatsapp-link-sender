import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage, setCsrf } from '../api';
import { AuthFrame } from '../components/AuthFrame';
import type { Me } from '../types';

export function Login({ onSignedIn, notice }: { onSignedIn: (me: Me) => void; notice?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ user: Me; csrf: string }>('/api/auth/login', { body: { username: username.trim(), password } });
      setCsrf(r.csrf);
      onSignedIn(r.user);
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <form onSubmit={submit} className="card p-6 sm:p-8" aria-labelledby="login-title">
        <h1 id="login-title" className="text-2xl font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="mt-1 mb-6 text-muted">Share your Facebook, TikTok and YouTube posts to your WhatsApp groups.</p>
        {notice && (
          <p role="status" className="mb-4 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
            {notice}
          </p>
        )}
        <label htmlFor="username" className="label">
          Username
        </label>
        <input
          id="username"
          className="field"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label htmlFor="password" className="label mt-4">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="field"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'login-error' : undefined}
        />
        {error && (
          <p id="login-error" role="alert" className="mt-3 text-sm text-bad">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary mt-6 w-full" disabled={busy || !username.trim() || !password}>
          <LogIn className="size-4" aria-hidden />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="hint mt-4 text-center">Forgot your password? Ask your admin to reset it.</p>
      </form>
    </AuthFrame>
  );
}
