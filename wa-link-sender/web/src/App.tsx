import { History as HistoryIcon, LogOut, Send as SendIcon, Settings as SettingsIcon, Smartphone, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { api, errorMessage, onUnauthorized } from './api';
import { StatusBadge } from './components/StatusBadge';
import { Connection } from './screens/Connection';
import { History } from './screens/History';
import { Login } from './screens/Login';
import { Send } from './screens/Send';
import { Settings } from './screens/Settings';
import { AppProvider, useApp } from './store';
import type { Bootstrap } from './types';

type Tab = 'send' | 'history' | 'connection' | 'settings';
const TABS: { id: Tab; label: string; icon: typeof SendIcon }[] = [
  { id: 'send', label: 'Send', icon: SendIcon },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'connection', label: 'Connection', icon: Smartphone },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];
const tabFromHash = (): Tab | null => {
  const h = window.location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as Tab) : null;
};

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'signedOut' | 'ready' | 'error'>('loading');
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await api<{ signedIn: boolean }>('/api/session');
      if (!s.signedIn) {
        setPhase('signedOut');
        return;
      }
      setBoot(await api<Bootstrap>('/api/bootstrap'));
      setPhase('ready');
    } catch (e) {
      setLoadError(errorMessage(e));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
    return onUnauthorized(() => setPhase('signedOut'));
  }, [load]);

  return (
    <>
      <Toaster position="top-center" theme="system" richColors closeButton toastOptions={{ className: 'font-sans' }} />
      {phase === 'loading' && <div className="grid min-h-dvh place-items-center text-muted">Loading…</div>}
      {phase === 'error' && (
        <div className="grid min-h-dvh place-items-center px-4">
          <div className="card max-w-sm p-6 text-center">
            <WifiOff className="mx-auto mb-3 size-8 text-bad" aria-hidden />
            <p className="font-semibold">Can’t load the app</p>
            <p className="hint mt-1">{loadError}</p>
            <button type="button" className="btn-primary mt-4" onClick={() => void load()}>
              Try again
            </button>
          </div>
        </div>
      )}
      {phase === 'signedOut' && <Login onSignedIn={() => void load()} />}
      {phase === 'ready' && boot && (
        <AppProvider initial={boot}>
          <Shell onSignOut={() => setPhase('signedOut')} />
        </AppProvider>
      )}
    </>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const { state } = useApp();
  const [tab, setTab] = useState<Tab>(() => tabFromHash() ?? (state.whatsapp.state === 'ready' ? 'send' : 'connection'));

  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash();
      if (t) setTab(t);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo({ top: 0 });
  };

  // Announce connection changes.
  const waState = state.whatsapp.state;
  const [prevState, setPrevState] = useState(waState);
  useEffect(() => {
    if (waState === prevState) return;
    if (waState === 'ready') toast.success('WhatsApp is connected.');
    else if (prevState === 'ready') toast.warning('WhatsApp disconnected. Trying to reconnect…');
    setPrevState(waState);
  }, [waState, prevState]);

  const signOut = async () => {
    try {
      await api('/api/logout', { body: {} });
    } finally {
      onSignOut();
    }
  };

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="min-h-dvh pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-10">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-lg font-bold tracking-tight">Link Sender</span>
          </div>
          <button type="button" className="ml-auto" onClick={() => go('connection')} aria-label="Open connection details">
            <StatusBadge state={waState} />
          </button>
          <button type="button" className="grid size-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
            <LogOut className="size-5" />
          </button>
        </div>
        <nav className="mx-auto hidden max-w-3xl gap-1 px-4 md:flex" aria-label="Main">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative flex items-center gap-2 px-3 py-3 font-semibold ${
                tab === t.id ? 'text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              <t.icon className="size-4" aria-hidden />
              {t.label}
              {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
      </header>

      {!state.live && (
        <p className="mx-auto mt-3 max-w-3xl px-4 text-sm text-muted" role="status">
          Live updates paused. Reconnecting to the app…
        </p>
      )}

      <main id="main" className="mx-auto max-w-3xl px-4 pt-5" tabIndex={-1}>
        <h1 className="sr-only">{current.label}</h1>
        {tab === 'send' && <Send onShowHistory={() => go('history')} />}
        {tab === 'history' && <History />}
        {tab === 'connection' && <Connection />}
        {tab === 'settings' && <Settings />}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Main"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${
              tab === t.id ? 'text-accent' : 'text-muted'
            }`}
          >
            <t.icon className="size-5" aria-hidden />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
