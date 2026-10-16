import {
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
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog } from './components/Dialog';
import { Brand, WhatsAppLogo } from './components/Logo';
import { PasswordForm } from './components/PasswordForm';
import { PauseBanner } from './components/PauseBanner';
import { Badge } from './components/StatusBadge';
import { Connections } from './screens/Connections';
import { Dashboard } from './screens/Dashboard';
import { GroupsPresets } from './screens/GroupsPresets';
import { History } from './screens/History';
import { Logs } from './screens/Logs';
import { Send } from './screens/Send';
import { Settings } from './screens/Settings';
import { Users } from './screens/Users';
import { useLive } from './store';

type Tab = 'dashboard' | 'send' | 'history' | 'users' | 'connections' | 'groups' | 'settings' | 'logs';
interface TabDef {
  id: Tab;
  label: string;
  /** Shorter label for the narrow desktop rail. */
  short?: string;
  icon: typeof SendIcon;
}
const ADMIN_TABS: TabDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'send', label: 'Send', icon: SendIcon },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'users', label: 'Users', icon: UsersIcon },
  { id: 'connections', label: 'Connections', short: 'Numbers', icon: Smartphone },
  { id: 'groups', label: 'Groups & Presets', short: 'Groups', icon: ListChecks },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'logs', label: 'Logs', icon: FileClock },
];
const USER_TABS: TabDef[] = [
  { id: 'send', label: 'Send', icon: SendIcon },
  { id: 'history', label: 'My history', short: 'History', icon: HistoryIcon },
];

/**
 * WhatsApp Web-style app frame.
 * Desktop: icon rail on the left + panel header. Mobile: WhatsApp green top bar with tabs.
 */
export function Shell({ onSignOut }: { onSignOut: () => void }) {
  const { isAdmin, live } = useLive();
  const tabs = isAdmin ? ADMIN_TABS : USER_TABS;
  const fromHash = (): Tab | null => {
    const h = window.location.hash.slice(1) as Tab;
    return tabs.some((t) => t.id === h) ? h : null;
  };
  const [tab, setTab] = useState<Tab>(() => fromHash() ?? (isAdmin ? 'dashboard' : 'send'));
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const t = fromHash();
      if (t) setTab(t);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo({ top: 0 });
  };
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  const menu = (placement: 'rail' | 'topbar') => (
    <UserMenu placement={placement} onSignOut={onSignOut} onChangePassword={() => setPwOpen(true)} />
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
        Skip to content
      </a>

      {/* Desktop: WhatsApp-style icon rail */}
      <aside className="sticky top-0 z-30 hidden h-dvh w-[88px] shrink-0 flex-col items-center border-r border-line bg-rail py-4 md:flex">
        <WhatsAppLogo size={40} title="Link Sender for WhatsApp" />
        <nav className="mt-5 flex w-full flex-1 flex-col items-stretch gap-1 overflow-y-auto px-2" aria-label="Main">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => go(t.id)}
                aria-current={active ? 'page' : undefined}
                title={t.label}
                className={`flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-[11px] leading-tight font-semibold transition-colors ${
                  active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <t.icon className="size-[22px]" aria-hidden strokeWidth={active ? 2.25 : 1.75} />
                <span className="text-center">{t.short ?? t.label}</span>
              </button>
            );
          })}
        </nav>
        {menu('rail')}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: WhatsApp green top bar with tabs */}
        <header className="sticky top-0 z-20 bg-topbar text-topbar-ink shadow-md md:hidden">
          <div className="flex h-14 items-center gap-3 px-4">
            <Brand onDark compact />
            <div className="ml-auto">{menu('topbar')}</div>
          </div>
          <nav className="flex overflow-x-auto px-1" aria-label="Main">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => go(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`relative shrink-0 px-4 py-3 text-sm font-semibold whitespace-nowrap ${tab === t.id ? 'text-topbar-ink' : 'text-topbar-ink/70'}`}
              >
                {t.label}
                {tab === t.id && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-topbar-ink" />}
              </button>
            ))}
          </nav>
        </header>

        {/* Desktop: panel header with page title and live status */}
        <header className="sticky top-0 z-20 hidden h-16 shrink-0 items-center gap-4 border-b border-line bg-surface px-6 md:flex">
          <p className="text-xl font-semibold tracking-tight" aria-hidden>
            {current.label}
          </p>
          <div className="ml-auto flex items-center gap-3">
            {!live && <span className="text-sm text-muted">Reconnecting live updates…</span>}
            <SendingChip onClick={isAdmin ? () => go('connections') : undefined} />
          </div>
        </header>

        <div className={`flex-1 ${tab === 'send' ? 'wallpaper' : ''}`}>
          <div className="px-4">
            <PauseBanner onOpenConnections={() => go('connections')} />
            {!live && (
              <p className="mx-auto mt-3 max-w-5xl text-sm text-muted md:hidden" role="status">
                Live updates paused. Reconnecting…
              </p>
            )}
          </div>
          <main id="main" className={`mx-auto px-4 pt-5 pb-12 ${tab === 'send' || tab === 'history' ? 'max-w-3xl' : 'max-w-5xl'}`} tabIndex={-1}>
            <h1 className="mb-4 text-2xl font-semibold tracking-tight md:sr-only">{current.label}</h1>
            {tab === 'dashboard' && isAdmin && <Dashboard go={go} />}
            {tab === 'send' && <Send onShowHistory={() => go('history')} />}
            {tab === 'history' && <History />}
            {tab === 'users' && isAdmin && <Users />}
            {tab === 'connections' && isAdmin && <Connections />}
            {tab === 'groups' && isAdmin && <GroupsPresets />}
            {tab === 'settings' && isAdmin && <Settings />}
            {tab === 'logs' && isAdmin && <Logs />}
          </main>
        </div>
      </div>

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

/** Live status of the active WhatsApp number, WhatsApp-style ("Online"). */
function SendingChip({ onClick }: { onClick?: () => void }) {
  const { sending } = useLive();
  if (!sending) return null;
  const transient = sending.reason === 'connecting' || sending.reason === 'disconnected';
  const tone = sending.available ? 'bg-ok-soft text-ok' : transient ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad';
  const text = sending.available ? `Online · ${sending.connection?.label ?? ''}` : transient ? 'Reconnecting…' : 'Sending paused';
  const content = (
    <>
      <span className="relative flex size-2">
        {transient && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
        <span className="relative inline-flex size-2 rounded-full bg-current" />
      </span>
      {text}
    </>
  );
  const cls = `inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${tone}`;
  return onClick ? (
    <button type="button" onClick={onClick} title="Open Connections" className={cls}>
      {content}
    </button>
  ) : (
    <span role="status" className={cls}>
      {content}
    </span>
  );
}

function UserMenu({ placement, onSignOut, onChangePassword }: { placement: 'rail' | 'topbar'; onSignOut: () => void; onChangePassword: () => void }) {
  const { me, isAdmin } = useLive();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const role = isAdmin ? 'Admin' : 'User';
  const popover = placement === 'rail' ? 'bottom-0 left-full ml-3' : 'right-0 top-full mt-2';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={`grid size-10 place-items-center rounded-full text-sm font-bold ${placement === 'rail' ? 'bg-accent text-accent-ink' : 'bg-topbar-ink/15 text-topbar-ink'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${me.displayName} (${role})`}
        title={`${me.displayName} · ${role}`}
        onClick={() => setOpen((v) => !v)}
      >
        {me.displayName.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div role="menu" className={`card absolute z-40 w-64 p-1.5 text-ink shadow-xl ${popover}`}>
          <div className="px-3 py-2.5">
            <p className="font-semibold">{me.displayName}</p>
            <p className="flex items-center gap-2 text-sm text-muted">
              @{me.username} <Badge tone={isAdmin ? 'accent' : 'neutral'}>{role}</Badge>
            </p>
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              onChangePassword();
            }}
          >
            <KeyRound className="size-4 text-muted" aria-hidden /> Change password
          </button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-bad hover:bg-bad-soft" onClick={onSignOut}>
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
