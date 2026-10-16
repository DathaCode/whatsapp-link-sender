import { WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { api, errorMessage, onUnauthorized, setCsrf } from './api';
import { setAppTimeZone } from './format';
import { Login } from './screens/Login';
import { SetPassword } from './screens/SetPassword';
import { Shell } from './Shell';
import { LiveProvider } from './store';
import type { Me } from './types';

type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'signedOut'; notice?: string } | { kind: 'mustChange'; me: Me } | { kind: 'ready'; me: Me };

interface SessionResponse {
  signedIn: boolean;
  expired?: boolean;
  user?: Me;
  csrf?: string;
  timeZone?: string;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const enter = useCallback((me: Me) => setPhase(me.mustChangePassword ? { kind: 'mustChange', me } : { kind: 'ready', me }), []);

  const load = useCallback(async () => {
    try {
      const s = await api<SessionResponse>('/api/auth/session');
      if (s.timeZone) setAppTimeZone(s.timeZone);
      if (!s.signedIn || !s.user) {
        setPhase({ kind: 'signedOut', notice: s.expired ? 'Your session timed out. Please sign in again.' : undefined });
        return;
      }
      setCsrf(s.csrf ?? '');
      enter(s.user);
    } catch (e) {
      setPhase({ kind: 'error', message: errorMessage(e) });
    }
  }, [enter]);

  useEffect(() => {
    void load();
    return onUnauthorized((code) =>
      setPhase({
        kind: 'signedOut',
        notice: code === 'session_expired' ? 'Your session timed out. Please sign in again.' : 'You were signed out. Please sign in again.',
      }),
    );
  }, [load]);

  const signOut = useCallback(async () => {
    try {
      await api('/api/auth/logout', { body: {} });
    } catch {
      /* already signed out */
    }
    setPhase({ kind: 'signedOut' });
  }, []);

  const signedOutByServer = useCallback(() => setPhase({ kind: 'signedOut', notice: 'You were signed out by an admin or your session ended.' }), []);

  return (
    <>
      <Toaster position="top-center" theme="system" richColors closeButton toastOptions={{ className: 'font-sans' }} />
      {phase.kind === 'loading' && <div className="grid min-h-dvh place-items-center text-muted">Loading…</div>}
      {phase.kind === 'error' && (
        <div className="grid min-h-dvh place-items-center px-4">
          <div className="card max-w-sm p-6 text-center">
            <WifiOff className="mx-auto mb-3 size-8 text-bad" aria-hidden />
            <p className="font-semibold">Can’t load the app</p>
            <p className="hint mt-1">{phase.message}</p>
            <button type="button" className="btn-primary mt-4" onClick={() => void load()}>
              Try again
            </button>
          </div>
        </div>
      )}
      {phase.kind === 'signedOut' && <Login notice={phase.notice} onSignedIn={() => void load()} />}
      {phase.kind === 'mustChange' && (
        <SetPassword
          me={phase.me}
          onDone={(me) => {
            toast.success('Password saved.');
            enter(me);
          }}
          onSignOut={() => void signOut()}
        />
      )}
      {phase.kind === 'ready' && (
        <LiveProvider me={phase.me} onSignedOut={signedOutByServer}>
          <Shell onSignOut={() => void signOut()} />
        </LiveProvider>
      )}
    </>
  );
}
