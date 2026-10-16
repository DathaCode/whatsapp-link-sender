import { Check, ChevronDown, Copy, ExternalLink, RotateCcw, Search, Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage, qs } from '../api';
import { ChatBubble } from '../components/ChatBubble';
import { JobThumb, jobText } from '../components/JobThumb';
import { Badge } from '../components/StatusBadge';
import { firstLines, formatDateTime, formatTime, plural, timeAgo, type Tone } from '../format';
import { useLive } from '../store';
import type { Job, JobStatus, UserView } from '../types';

const PAGE = 30;

const STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Waiting to start', tone: 'neutral' },
  running: { label: 'Sending', tone: 'accent' },
  waiting: { label: 'Paused', tone: 'warn' },
  done: { label: 'Done', tone: 'ok' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
};

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for plain-http LAN access, where the Clipboard API is unavailable.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

const hrefOf = (link: string) => (/^https?:\/\//i.test(link) ? link : `https://${link}`);

export function History() {
  const { jobs: liveJobs, upsertJob, isAdmin } = useLive();
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<UserView[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const searchId = useId();

  useEffect(() => {
    if (isAdmin) api<{ users: UserView[] }>('/api/admin/users').then((r) => setUsers(r.users), () => {});
  }, [isAdmin]);

  const load = useCallback(async (q: string, uid: string, offset: number) => {
    setLoading(true);
    try {
      const r = await api<{ jobs: Job[] }>(`/api/jobs${qs({ limit: PAGE, offset, search: q.trim(), userId: uid })}`);
      setJobs((prev) => (offset ? [...prev, ...r.jobs] : r.jobs));
      setHasMore(r.jobs.length === PAGE);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search, userId, 0), 250);
    return () => clearTimeout(t);
  }, [search, userId, load]);

  // Merge live progress into the visible rows.
  useEffect(() => {
    setJobs((prev) => prev.map((j) => (liveJobs[j.id] ? { ...j, ...liveJobs[j.id], items: liveJobs[j.id]!.items ?? j.items } : j)));
  }, [liveJobs]);

  const toggle = async (job: Job) => {
    if (open === job.id) return setOpen(null);
    setOpen(job.id);
    try {
      const r = await api<{ job: Job }>(`/api/jobs/${job.id}`);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? r.job : j)));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const retry = async (job: Job) => {
    try {
      const r = await api<{ job: Job }>(`/api/jobs/${job.id}/retry-failed`, { body: {} });
      upsertJob(r.job);
      setJobs((prev) => [r.job, ...prev]);
      toast.success(`Retrying ${plural(r.job.total, 'group')}. Follow progress on the Send page.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor={searchId} className="sr-only">
            Search messages and links
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input id={searchId} type="search" className="field min-h-12 pl-11" placeholder="Search messages and links" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isAdmin && (
          <div className="sm:w-56">
            <label htmlFor="hist-user" className="sr-only">
              Filter by user
            </label>
            <select id="hist-user" className="field min-h-12" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.username})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!loading && jobs.length === 0 && (
        <p className="card p-8 text-center text-muted">{search ? `Nothing sent matches “${search}”.` : 'Nothing has been sent yet. Sends will be listed here.'}</p>
      )}

      <ul className="space-y-3" role="list">
        {jobs.map((job) => {
          const st = STATUS[job.status];
          const expanded = open === job.id;
          const text = jobText(job);
          const links = job.messageText ? job.links.map((l) => l.cleaned) : job.url ? [job.url] : [];
          return (
            <li key={job.id} className="card overflow-hidden">
              <div className="flex items-start gap-3 p-4">
                <JobThumb job={job} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="font-message line-clamp-2 font-semibold break-words whitespace-pre-line">{firstLines(text, 2) || '(empty message)'}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
                    <time dateTime={new Date(job.createdAt).toISOString()} title={formatDateTime(job.createdAt)}>
                      {timeAgo(job.createdAt)}
                    </time>
                    <span>· by {job.username}</span>
                    {job.connectionLabel && (
                      <span className="inline-flex items-center gap-1">
                        · <Smartphone className="size-3.5" aria-hidden /> {job.connectionLabel}
                      </span>
                    )}
                    {job.parentJobId ? <span>· retry</span> : null}
                    {job.imageId && <span>· {job.sendMode === 'two' ? 'image + text' : 'image + caption'}</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="inline-flex items-center gap-1 text-ok">
                      <Check className="size-4" aria-hidden /> {job.sent} sent
                    </span>
                    {job.failed > 0 && (
                      <span className="inline-flex items-center gap-1 text-bad">
                        <X className="size-4" aria-hidden /> {job.failed} failed
                      </span>
                    )}
                    {job.pending > 0 && <span className="text-muted">{job.pending} to go</span>}
                  </div>
                  {links.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5" role="list" aria-label="Links">
                      {links.slice(0, 6).map((l, i) => (
                        <li key={`${l}-${i}`}>
                          <a
                            href={hrefOf(l)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-64 items-center gap-1 truncate rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-accent hover:text-accent"
                            title={l}
                          >
                            <span className="truncate">{l.replace(/^https?:\/\/(www\.)?/, '')}</span>
                            <ExternalLink className="size-3 shrink-0" aria-label="(opens in new tab)" />
                          </a>
                        </li>
                      ))}
                      {links.length > 6 && <li className="text-xs text-muted">+{links.length - 6} more</li>}
                    </ul>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
                <button
                  type="button"
                  className="btn-quiet min-h-9 px-3 text-sm"
                  onClick={async () => {
                    await copyText(text);
                    toast.success('Message copied.');
                  }}
                >
                  <Copy className="size-4" aria-hidden /> Copy text
                </button>
                {job.failed > 0 && (job.status === 'done' || job.status === 'cancelled') && (
                  <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => void retry(job)}>
                    <RotateCcw className="size-4" aria-hidden /> Retry {plural(job.failed, 'failed group')}
                  </button>
                )}
                <button
                  type="button"
                  className="ml-auto inline-flex min-h-9 items-center gap-1 px-2 text-sm font-semibold text-accent"
                  aria-expanded={expanded}
                  onClick={() => void toggle(job)}
                >
                  {expanded ? 'Hide' : 'Details'}
                  <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                </button>
              </div>

              {expanded && (
                <div className="space-y-3 border-t border-line bg-surface-2/50 p-4">
                  <ChatBubble text={text} links={links} imageUrl={job.imageId ? `/api/uploads/${job.imageId}` : null} />
                  <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface text-sm">
                    {!job.items && <li className="px-4 py-3 text-muted">Loading…</li>}
                    {job.items?.map((it) => (
                      <li key={it.id} className="flex items-start gap-3 px-4 py-2">
                        {it.status === 'sent' ? (
                          <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Sent" />
                        ) : it.status === 'failed' ? (
                          <X className="mt-0.5 size-4 shrink-0 text-bad" aria-label="Failed" />
                        ) : (
                          <span className="mt-0.5 size-4 shrink-0 text-center text-muted" aria-label={it.status}>
                            –
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{it.groupName}</span>
                          {it.error && <span className="block text-bad">{it.error}</span>}
                        </span>
                        {it.attemptedAt && <span className="shrink-0 text-muted">{formatTime(it.attemptedAt)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button type="button" className="btn-quiet w-full" disabled={loading} onClick={() => void load(search, userId, jobs.length)}>
          {loading ? 'Loading…' : 'Show older'}
        </button>
      )}
    </div>
  );
}
