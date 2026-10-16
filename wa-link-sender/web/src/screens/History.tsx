import { Check, ChevronDown, Copy, ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { PlatformIcon } from '../components/PlatformIcon';
import { formatDateTime, plural, timeAgo } from '../format';
import { useApp } from '../store';
import type { Job, JobStatus } from '../types';

const PAGE = 30;

const STATUS: Record<JobStatus, { label: string; cls: string }> = {
  queued: { label: 'Waiting to start', cls: 'bg-surface-2 text-muted' },
  running: { label: 'Sending', cls: 'bg-accent-soft text-accent' },
  waiting: { label: 'Paused', cls: 'bg-warn-soft text-warn' },
  done: { label: 'Done', cls: 'bg-ok-soft text-ok' },
  cancelled: { label: 'Stopped', cls: 'bg-surface-2 text-muted' },
};

async function copyText(text: string) {
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

export function History() {
  const { state, upsertJob } = useApp();
  const [search, setSearch] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const searchId = useId();

  const load = useCallback(async (q: string, offset: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (q.trim()) params.set('search', q.trim());
      const r = await api<{ jobs: Job[] }>(`/api/jobs?${params}`);
      setJobs((prev) => (offset ? [...prev, ...r.jobs] : r.jobs));
      setHasMore(r.jobs.length === PAGE);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search, 0), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  // Merge live updates (progress, new retries) into the list.
  useEffect(() => {
    setJobs((prev) => {
      const live = Object.values(state.jobs);
      const merged = prev.map((j) => {
        const l = state.jobs[j.id];
        return l ? { ...j, ...l, items: l.items ?? j.items } : j;
      });
      const fresh = live.filter((l) => !prev.some((j) => j.id === l.id) && (!search || l.url.includes(search)));
      return fresh.length ? [...fresh, ...merged].sort((a, b) => b.id - a.id) : merged;
    });
  }, [state.jobs, search]);

  const toggle = async (job: Job) => {
    if (open === job.id) {
      setOpen(null);
      return;
    }
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
      toast.success(`Retrying ${plural(r.job.total, 'group')}. Follow progress on the Send tab.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search history by link
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id={searchId}
          type="search"
          className="field min-h-12 pl-11"
          placeholder="Search by link"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!loading && jobs.length === 0 && (
        <p className="card p-8 text-center text-muted">
          {search ? `Nothing sent matches “${search}”.` : 'Nothing has been sent yet. Your sends will be listed here.'}
        </p>
      )}

      <ul className="space-y-3" role="list">
        {jobs.map((job) => {
          const st = STATUS[job.status];
          const expanded = open === job.id;
          return (
            <li key={job.id} className="card overflow-hidden">
              <div className="flex items-start gap-3 p-4">
                <PlatformIcon platform={job.platform} size={28} />
                <div className="min-w-0 flex-1">
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-semibold hover:text-accent hover:underline"
                    title={job.url}
                  >
                    {job.url.replace(/^https:\/\/(www\.)?/, '')}
                    <ExternalLink className="ml-1 inline size-3.5 align-baseline text-muted" aria-label="(opens in new tab)" />
                  </a>
                  <p className="mt-0.5 text-sm text-muted">
                    <time dateTime={new Date(job.createdAt).toISOString()} title={formatDateTime(job.createdAt)}>
                      {timeAgo(job.createdAt)}
                    </time>
                    {job.parentJobId ? ' · retry' : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded-full px-2.5 py-0.5 font-semibold ${st.cls}`}>{st.label}</span>
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
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
                <button
                  type="button"
                  className="btn-quiet min-h-9 px-3 text-sm"
                  onClick={async () => {
                    await copyText(job.url);
                    toast.success('Link copied.');
                  }}
                >
                  <Copy className="size-4" aria-hidden /> Copy link
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
                  {expanded ? 'Hide' : 'Groups'}
                  <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                </button>
              </div>

              {expanded && (
                <ul className="max-h-80 divide-y divide-line overflow-y-auto border-t border-line bg-surface-2/50 text-sm">
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
                      {it.attemptedAt && <span className="shrink-0 text-muted">{new Date(it.attemptedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button type="button" className="btn-quiet w-full" disabled={loading} onClick={() => void load(search, jobs.length)}>
          {loading ? 'Loading…' : 'Show older'}
        </button>
      )}
    </div>
  );
}
