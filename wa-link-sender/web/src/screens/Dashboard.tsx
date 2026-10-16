import { AlertTriangle, ArrowRight, Ban, Send, Smartphone, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { ConnectionBadge, Badge } from '../components/StatusBadge';
import { formatTime, plural, timeAgo } from '../format';
import { useLive } from '../store';
import type { ConnectionView, Job, Outcome, QueueStatus, SafetySettings, SendingStatus, Usage } from '../types';

interface DashboardData {
  sending: SendingStatus;
  connections: ConnectionView[];
  usage: Usage;
  settings: SafetySettings;
  queue: QueueStatus;
  activeJobs: Job[];
  recentFailures: { id: number; jobId: number; groupName: string; error: string | null; attemptedAt: number | null; url: string; username: string }[];
  recentLogins: { ts: number; username: string; outcome: Outcome; reason: string | null; ip: string | null }[];
  counts: { users: number; jobsToday: number; deniedLast24h: number };
}

export function Dashboard({ go }: { go: (tab: 'connections' | 'logs' | 'history' | 'users' | 'send') => void }) {
  const live = useLive();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<DashboardData>('/api/admin/dashboard'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <p className="card p-6 text-bad">{error}</p>;
  if (!data) return <p className="py-10 text-center text-muted">Loading…</p>;

  const usage = live.usage ?? data.usage;
  const active = (live.connections ?? data.connections).find((c) => c.isActive) ?? null;
  const pct = Math.min(100, Math.round((usage.used / Math.max(1, usage.cap)) * 100));
  const meterTone = pct >= 100 ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-accent';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Connection */}
      <section className="card p-5" aria-labelledby="dash-conn">
        <div className="flex items-center justify-between gap-2">
          <h2 id="dash-conn" className="flex items-center gap-2 font-bold">
            <Smartphone className="size-5 text-accent" aria-hidden /> Sending number
          </h2>
          {active ? <ConnectionBadge status={active.status} /> : <Badge tone="bad">None active</Badge>}
        </div>
        {active ? (
          <>
            <p className="mt-3 text-xl font-bold">{active.label}</p>
            <p className="text-muted">{active.phone ? `+${active.phone}` : 'Not linked yet'}{active.pushName ? ` · ${active.pushName}` : ''}</p>
            {active.lastError && active.status !== 'connected' && <p className="mt-2 text-sm text-bad">{active.lastError}</p>}
          </>
        ) : (
          <p className="mt-3 text-muted">No WhatsApp number is active, so nothing can be sent.</p>
        )}
        <button type="button" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent" onClick={() => go('connections')}>
          Manage connections <ArrowRight className="size-4" aria-hidden />
        </button>
      </section>

      {/* Usage */}
      <section className="card p-5" aria-labelledby="dash-usage">
        <h2 id="dash-usage" className="flex items-center gap-2 font-bold">
          <Send className="size-5 text-accent" aria-hidden /> Messages today
        </h2>
        <p className="mt-3 text-3xl font-bold tabular-nums">
          {usage.used} <span className="text-lg font-semibold text-muted">of {usage.cap}</span>
        </p>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={usage.cap} aria-valuenow={usage.used} aria-label="Messages sent today">
          <div className={`h-full ${meterTone}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="hint mt-2">
          {plural(data.counts.jobsToday, 'send')} started today · {plural(data.activeJobs.length, 'send')} in progress or waiting · sending hours {data.settings.windowStart}–{data.settings.windowEnd}
        </p>
      </section>

      {/* Recent failures */}
      <section className="card p-5" aria-labelledby="dash-fail">
        <div className="flex items-center justify-between">
          <h2 id="dash-fail" className="flex items-center gap-2 font-bold">
            <AlertTriangle className="size-5 text-bad" aria-hidden /> Recent failures
          </h2>
          <button type="button" className="text-sm font-semibold text-accent" onClick={() => go('history')}>
            History
          </button>
        </div>
        {data.recentFailures.length === 0 ? (
          <p className="mt-3 text-muted">No failed messages. 🎉</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {data.recentFailures.map((f) => (
              <li key={f.id} className="py-2">
                <p className="flex justify-between gap-2">
                  <span className="truncate font-semibold">{f.groupName}</span>
                  <span className="shrink-0 text-muted">{f.attemptedAt ? timeAgo(f.attemptedAt) : ''}</span>
                </p>
                <p className="truncate text-bad">{f.error}</p>
                <p className="truncate text-muted">
                  {f.url} · {f.username}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent logins */}
      <section className="card p-5" aria-labelledby="dash-logins">
        <div className="flex items-center justify-between">
          <h2 id="dash-logins" className="flex items-center gap-2 font-bold">
            <Users className="size-5 text-accent" aria-hidden /> Recent sign-ins
          </h2>
          <button type="button" className="text-sm font-semibold text-accent" onClick={() => go('logs')}>
            All logs
          </button>
        </div>
        {data.counts.deniedLast24h > 0 && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
            <Ban className="size-4" aria-hidden /> {plural(data.counts.deniedLast24h, 'blocked request')} in the last 24 hours.
          </p>
        )}
        <ul className="mt-3 divide-y divide-line text-sm">
          {data.recentLogins.map((l, i) => (
            <li key={i} className="flex items-center gap-2 py-2">
              <Badge tone={l.outcome === 'success' ? 'ok' : 'bad'}>{l.outcome === 'success' ? 'OK' : l.reason === 'account_locked' || !l.reason ? 'Failed' : l.reason.replace(/_/g, ' ')}</Badge>
              <span className="min-w-0 flex-1 truncate font-semibold">{l.username}</span>
              <span className="shrink-0 text-muted">{formatTime(l.ts)}</span>
            </li>
          ))}
          {data.recentLogins.length === 0 && <li className="py-2 text-muted">No sign-ins yet.</li>}
        </ul>
      </section>
    </div>
  );
}
