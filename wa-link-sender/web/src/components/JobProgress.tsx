import { Check, CircleDashed, Clock, Loader2, Minus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { waitReasonText } from '../format';
import { useApp } from '../store';
import type { ItemStatus, Job } from '../types';
import { PlatformIcon } from './PlatformIcon';

const ITEM_ICON: Record<ItemStatus, { icon: typeof Check; cls: string; label: string }> = {
  pending: { icon: CircleDashed, cls: 'text-muted', label: 'Waiting' },
  sending: { icon: Loader2, cls: 'text-accent animate-spin', label: 'Sending now' },
  sent: { icon: Check, cls: 'text-ok', label: 'Sent' },
  failed: { icon: X, cls: 'text-bad', label: 'Failed' },
  cancelled: { icon: Minus, cls: 'text-muted', label: 'Cancelled' },
};

function useCountdown(target: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  return target ? Math.max(0, Math.ceil((target - now) / 1000)) : null;
}

export function JobProgress({ job }: { job: Job }) {
  const { state } = useApp();
  const isActive = state.queue.activeJobId === job.id;
  const countdown = useCountdown(isActive ? state.queue.nextSendAt : null);
  const done = job.sent + job.failed;
  const pct = job.total ? Math.round((done / job.total) * 100) : 0;
  const finished = job.status === 'done' || job.status === 'cancelled';
  const [cancelling, setCancelling] = useState(false);

  let headline: string;
  if (job.status === 'done') headline = job.failed ? `Finished. ${job.failed} of ${job.total} failed.` : `Sent to all ${job.total} groups.`;
  else if (job.status === 'cancelled') headline = `Stopped. Sent to ${job.sent} of ${job.total} groups.`;
  else if (job.status === 'waiting') headline = waitReasonText(job.waitReason, state.settings);
  else if (job.status === 'queued') headline = 'Waiting for the send before this one to finish.';
  else if (job.items?.some((i) => i.status === 'sending')) headline = `Sending ${done + 1} of ${job.total}…`;
  else if (countdown !== null && countdown > 0) headline = `Next group in ${countdown} s (a short pause keeps your number safe).`;
  else headline = `Sending ${Math.min(done + 1, job.total)} of ${job.total}…`;

  const cancel = async () => {
    setCancelling(true);
    try {
      await api(`/api/jobs/${job.id}/cancel`, { method: 'POST', body: {} });
      toast.success('Stopped. Groups not yet reached were skipped.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby={`job-${job.id}`}>
      <div className="flex items-start gap-3">
        <PlatformIcon platform={job.platform} size={28} />
        <div className="min-w-0 flex-1">
          <h3 id={`job-${job.id}`} className="font-semibold" aria-live="polite">
            {headline}
          </h3>
          <p className="truncate text-sm text-muted">{job.url}</p>
        </div>
        {!finished && (
          <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={cancel} disabled={cancelling}>
            Stop
          </button>
        )}
      </div>

      <div
        className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.total}
        aria-valuenow={done}
        aria-label="Groups done"
      >
        <div className="flex h-full">
          <div className="h-full bg-ok transition-[width] duration-500" style={{ width: `${(job.sent / Math.max(1, job.total)) * 100}%` }} />
          <div className="h-full bg-bad transition-[width] duration-500" style={{ width: `${(job.failed / Math.max(1, job.total)) * 100}%` }} />
        </div>
      </div>
      <p className="mt-1.5 flex justify-between text-sm text-muted">
        <span>
          {job.sent} sent{job.failed ? ` · ${job.failed} failed` : ''}
        </span>
        <span>{pct}%</span>
      </p>

      {job.items && job.items.length > 0 && (
        <details className="mt-3 group" open={!finished && job.items.length <= 12}>
          <summary className="cursor-pointer text-sm font-semibold text-accent select-none">Show each group</summary>
          <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {job.items.map((it) => {
              const s = ITEM_ICON[it.status];
              const Icon = s.icon;
              return (
                <li key={it.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${s.cls}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.groupName}</span>
                    {it.error && <span className="block text-bad">{it.error}</span>}
                  </span>
                  <span className="sr-only">{s.label}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {job.status === 'waiting' && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          <Clock className="size-4 shrink-0" aria-hidden /> Nothing is lost. This send is saved and continues by itself.
        </p>
      )}
    </section>
  );
}
