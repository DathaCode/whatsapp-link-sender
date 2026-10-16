import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/login', { body: { key: key.trim() } });
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 sm:p-8" aria-labelledby="login-title">
        <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <KeyRound className="size-6" aria-hidden />
        </div>
        <h1 id="login-title" className="text-2xl font-bold tracking-tight">
          Link Sender
        </h1>
        <p className="mt-1 mb-6 text-muted">Share your posts to your WhatsApp groups. Enter the team access key to continue.</p>
        <label htmlFor="key" className="label">
          Access key
        </label>
        <input
          id="key"
          type="password"
          className="field"
          autoComplete="current-password"
          autoFocus
          required
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'login-error' : undefined}
        />
        {error && (
          <p id="login-error" role="alert" className="mt-2 text-sm text-bad">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary mt-5 w-full" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
