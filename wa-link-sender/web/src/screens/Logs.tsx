import { ChevronDown, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage, qs } from '../api';
import { Badge } from '../components/StatusBadge';
import { formatDateTime, plural } from '../format';
import type { AuditRow, Outcome } from '../types';

const PAGE = 50;

interface Meta {
  categories: string[];
  outcomes: Outcome[];
  users: { id: number; username: string }[];
  connections: { id: number; label: string; phone: string | null }[];
  timeZone: string;
  retentionDays: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  auth: 'Sign-in & passwords',
  access: 'Blocked requests',
  user: 'Users',
  connection: 'WhatsApp numbers',
  group: 'Groups',
  preset: 'Presets',
  template: 'Templates',
  settings: 'Settings',
  send: 'Sending',
  system: 'System',
};

const OUTCOME = {
  success: { tone: 'ok' as const, label: 'Success', row: '' },
  failure: { tone: 'bad' as const, label: 'Failed', row: 'border-l-4 border-l-bad bg-bad-soft/40' },
  denied: { tone: 'warn' as const, label: 'Denied', row: 'border-l-4 border-l-warn bg-warn-soft/50' },
};

/** "2026-10-16" (date input, browser time) → epoch ms at the start or end of that day. */
const dayToMs = (v: string, end: boolean) => (v ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}`).getTime() : undefined);

export function Logs() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filters, setFilters] = useState({ from: '', to: '', userId: '', category: '', outcome: '', connectionId: '', q: '' });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api<Meta>('/api/admin/audit/meta').then(setMeta, (e) => toast.error(errorMessage(e)));
  }, []);

  // Debounce the free-text box.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === q ? f : { ...f, q })), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo(
    () => ({
      from: dayToMs(filters.from, false),
      to: dayToMs(filters.to, true),
      userId: filters.userId,
      category: filters.category,
      outcome: filters.outcome,
      connectionId: filters.connectionId,
      q: filters.q.trim(),
    }),
    [filters],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ rows: AuditRow[]; total: number }>(`/api/admin/audit${qs({ ...query, limit: PAGE, offset: page * PAGE })}`);
      setRows(r.rows);
      setTotal(r.total);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [query, page]);
  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(0);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const exportHref = `/api/admin/audit/export${qs(query)}`;
  const connName = (id: number | null) => meta?.connections.find((c) => c.id === id)?.label;

  return (
    <div className="space-y-4">
      <section className="card p-4" aria-label="Filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2">
            <label htmlFor="log-q" className="label">
              Search
            </label>
            <Search className="pointer-events-none absolute bottom-3.5 left-3 size-4 text-muted" aria-hidden />
            <input id="log-q" type="search" className="field pl-9" placeholder="Action, user, IP, group, URL…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label htmlFor="log-from" className="label">
              From
            </label>
            <input id="log-from" type="date" className="field" value={filters.from} onChange={set('from')} />
          </div>
          <div>
            <label htmlFor="log-to" className="label">
              To
            </label>
            <input id="log-to" type="date" className="field" value={filters.to} onChange={set('to')} />
          </div>
          <div>
            <label htmlFor="log-user" className="label">
              User
            </label>
            <select id="log-user" className="field" value={filters.userId} onChange={set('userId')}>
              <option value="">Anyone</option>
              {meta?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="log-cat" className="label">
              Category
            </label>
            <select id="log-cat" className="field" value={filters.category} onChange={set('category')}>
              <option value="">All</option>
              {meta?.categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c] ?? c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="log-outcome" className="label">
              Outcome
            </label>
            <select id="log-outcome" className="field" value={filters.outcome} onChange={set('outcome')}>
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="failure">Failed</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div>
            <label htmlFor="log-conn" className="label">
              WhatsApp number
            </label>
            <select id="log-conn" className="field" value={filters.connectionId} onChange={set('connectionId')}>
              <option value="">Any</option>
              {meta?.connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.phone ? ` (+${c.phone})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted" aria-live="polite">
            {loading ? 'Loading…' : `${plural(total, 'entry', 'entries')} · times in ${meta?.timeZone ?? ''} · kept for ${meta?.retentionDays ?? '…'} days`}
          </span>
          <a className="btn-quiet min-h-9 px-3 text-sm" href={exportHref} download>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        </div>
      </section>

      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface" role="list">
        {!loading && rows.length === 0 && <li className="p-6 text-center text-muted">No entries match these filters.</li>}
        {rows.map((r) => {
          const o = OUTCOME[r.outcome];
          const expanded = open === r.id;
          let details: unknown = null;
          try {
            details = r.details ? JSON.parse(r.details) : null;
          } catch {
            details = r.details;
          }
          return (
            <li key={r.id} className={o.row}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-surface-2/60"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : r.id)}
              >
                <span className="w-44 shrink-0 text-muted tabular-nums">{formatDateTime(r.ts)}</span>
                <Badge tone={o.tone}>{o.label}</Badge>
                <code className="font-semibold">{r.action}</code>
                <span className="text-muted">
                  by <span className="text-ink">{r.actorUsername}</span>
                </span>
                {r.reason && <span className="min-w-0 flex-1 truncate text-muted">· {r.reason}</span>}
                <ChevronDown className={`ml-auto size-4 shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {expanded && (
                <div className="border-t border-line bg-surface-2/50 px-4 py-3 text-sm">
                  <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
                    <dt className="text-muted">When (UTC)</dt>
                    <dd className="tabular-nums">{new Date(r.ts).toISOString()}</dd>
                    <dt className="text-muted">Who</dt>
                    <dd>
                      {r.actorUsername}
                      {r.actorRole ? ` (${r.actorRole})` : ''}
                      {r.actorUserId ? ` · user #${r.actorUserId}` : ''}
                    </dd>
                    {r.targetType && (
                      <>
                        <dt className="text-muted">Target</dt>
                        <dd className="break-all">
                          {r.targetType} {r.targetId}
                        </dd>
                      </>
                    )}
                    {r.connectionId && (
                      <>
                        <dt className="text-muted">WhatsApp number</dt>
                        <dd>{connName(r.connectionId) ?? `#${r.connectionId}`}</dd>
                      </>
                    )}
                    {r.reason && (
                      <>
                        <dt className="text-muted">Reason</dt>
                        <dd>{r.reason}</dd>
                      </>
                    )}
                    <dt className="text-muted">IP address</dt>
                    <dd>{r.ip ?? '–'}</dd>
                    <dt className="text-muted">Browser</dt>
                    <dd className="break-all">{r.userAgent ?? '–'}</dd>
                    <dt className="text-muted">Session</dt>
                    <dd className="break-all">{r.sessionId ?? '–'}</dd>
                  </dl>
                  {details !== null && (
                    <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-surface p-3 text-xs break-words whitespace-pre-wrap">{JSON.stringify(details, null, 2)}</pre>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Pages">
          <button type="button" className="btn-quiet min-h-9 px-3" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-4" aria-hidden /> Newer
          </button>
          <span className="text-sm text-muted">
            Page {page + 1} of {pages}
          </span>
          <button type="button" className="btn-quiet min-h-9 px-3" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>
            Older <ChevronRight className="size-4" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
