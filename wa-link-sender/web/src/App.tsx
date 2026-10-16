import {
  ChevronDown,
  FileClock,
  History as HistoryIcon,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Send as SendIcon,
  Settings as SettingsIcon,
  Smartphone,
  Users as UsersIcon,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { api, errorMessage, onUnauthorized, setCsrf } from './api';
import { Dialog } from './components/Dialog';
import { PasswordForm } from './components/PasswordForm';
import { PauseBanner } from './components/PauseBanner';
import { Badge } from './components/StatusBadge';
import { setAppTimeZone } from './format';
import { Connections } from './screens/Connections';
import { Dashboard } from './screens/Dashboard';
import { GroupsPresets } from './screens/GroupsPresets';
import { History } from './screens/History';
import { Login } from './screens/Login';
import { Logs } from './screens/Logs';
import { Send } from './screens/Send';
import { SetPassword } from './screens/SetPassword';
import { Settings } from './screens/Settings';
import { Users } from './screens/Users';
import { LiveProvider, useLive } from './store';
import type { Me } from './types';

type Tab = 'dashboard' | 'send' | 'history' | 'users' | 'connections' | 'groups' | 'settings' | 'logs';
interface TabDef {
  id: Tab;
  label: string;
  icon: typeof SendIcon;
}
const ADMIN_TABS: TabDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'send', label: 'Send', icon: SendIcon },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'users', label: 'Users', icon: UsersIcon },
  { id: 'connections', label: 'Connections', icon: Smartphone },
  { id: 'groups', label: 'Groups & Presets', icon: ListChecks },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'logs', label: 'Logs', icon: FileClock },
];
const USER_TABS: TabDef[] = [
  { id: 'send', label: 'Send', icon: SendIcon },
  { id: 'history', label: 'My history', icon: HistoryIcon },
];

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

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const { me, isAdmin, live } = useLive();
  const tabs = isAdmin ? ADMIN_TABS : USER_TABS;
  const fromHash = (): Tab | null => {
    const h = window.location.hash.slice(1) as Tab;
    return tabs.some((t) => t.id === h) ? h : null;
  };
  const [tab, setTab] = useState<Tab>(() => fromHash() ?? (isAdmin ? 'dashboard' : 'send'));
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onHash = () => {
      const t = fromHash();
      if (t) setTab(t);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo({ top: 0 });
  };
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;

  return (
    <div className="min-h-dvh pb-10">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-lg font-bold tracking-tight">Link Sender</span>
          </div>
          <div ref={menuRef} className="relative ml-auto">
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent" aria-hidden>
                {me.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-semibold">{me.displayName}</span>
                <span className="block text-xs text-muted">{isAdmin ? 'Admin' : 'User'}</span>
              </span>
              <ChevronDown className="size-4 text-muted" aria-hidden />
            </button>
            {menuOpen && (
              <div role="menu" className="card absolute right-0 mt-2 w-60 p-1.5 shadow-xl">
                <div className="px-3 py-2 sm:hidden">
                  <p className="font-semibold">{me.displayName}</p>
                  <Badge tone={isAdmin ? 'accent' : 'neutral'}>{isAdmin ? 'Admin' : 'User'}</Badge>
                </div>
                <p className="hidden px-3 py-2 text-xs text-muted sm:block">Signed in as @{me.username}</p>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2"
                  onClick={() => {
                    setMenuOpen(false);
                    setPwOpen(true);
                  }}
                >
                  <KeyRound className="size-4" aria-hidden /> Change password
                </button>
                <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2" onClick={onSignOut}>
                  <LogOut className="size-4" aria-hidden /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 sm:px-4" aria-label="Main">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative flex shrink-0 items-center gap-2 px-3 py-3 text-sm font-semibold whitespace-nowrap ${tab === t.id ? 'text-accent' : 'text-muted hover:text-ink'}`}
            >
              <t.icon className="size-4" aria-hidden />
              {t.label}
              {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
      </header>

      <div className="px-4">
        <PauseBanner onOpenConnections={() => go('connections')} />
        {!live && (
          <p className="mx-auto mt-3 max-w-5xl text-sm text-muted" role="status">
            Live updates paused. Reconnecting…
          </p>
        )}
      </div>

      <main id="main" className={`mx-auto px-4 pt-5 ${tab === 'send' || tab === 'history' ? 'max-w-3xl' : 'max-w-5xl'}`} tabIndex={-1}>
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{current.label}</h1>
        {tab === 'dashboard' && isAdmin && <Dashboard go={go} />}
        {tab === 'send' && <Send onShowHistory={() => go('history')} />}
        {tab === 'history' && <History />}
        {tab === 'users' && isAdmin && <Users />}
        {tab === 'connections' && isAdmin && <Connections />}
        {tab === 'groups' && isAdmin && <GroupsPresets />}
        {tab === 'settings' && isAdmin && <Settings />}
        {tab === 'logs' && isAdmin && <Logs />}
      </main>

      <Dialog open={pwOpen} title="Change your password" onClose={() => setPwOpen(false)}>
        <PasswordForm
          onCancel={() => setPwOpen(false)}
          onDone={() => {
            setPwOpen(false);
            toast.success('Password changed. Other devices were signed out.');
          }}
        />
      </Dialog>
    </div>
  );
}
