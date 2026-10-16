import { AlertTriangle, Check, ClipboardPaste, Send as SendIcon, Shuffle, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError, api, errorMessage } from '../api';
import { ChatBubble } from '../components/ChatBubble';
import { ConfirmDialog } from '../components/Dialog';
import { GroupPicker } from '../components/GroupPicker';
import { JobProgress } from '../components/JobProgress';
import { PlatformIcon } from '../components/PlatformIcon';
import { PLATFORM_NAME, estimateSeconds, formatDateTime, formatDuration, pauseText, plural, renderTemplate } from '../format';
import { useLive } from '../store';
import type { Group, Job, LinkCheck, SendOptions } from '../types';

const TEMPLATE_KEY = 'wls.template';
const loadLocal = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const saveLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

export function Send({ onShowHistory }: { onShowHistory: () => void }) {
  const live = useLive();
  const { isAdmin, upsertJob, sending: liveSending, usage: liveUsage, groupsVersion } = live;
  const [opts, setOpts] = useState<SendOptions | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      setOpts(await api<SendOptions>('/api/send/options'));
      setLoadError('');
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);
  const activeConnectionId = liveSending?.connection?.id ?? null;
  useEffect(() => {
    void load();
  }, [load, groupsVersion, activeConnectionId]);

  const [url, setUrl] = useState('');
  const [check, setCheck] = useState<LinkCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [templateChoice, setTemplateChoice] = useState(() => loadLocal(TEMPLATE_KEY, 'rotate'));
  const [presetIds, setPresetIds] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewSeed, setPreviewSeed] = useState(0);
  const [sending, setSending] = useState(false);
  const [duplicate, setDuplicate] = useState<{ at: number; groups: number; by: string } | null>(null);
  const [myJobIds, setMyJobIds] = useState<number[]>([]);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveLocal(TEMPLATE_KEY, templateChoice), [templateChoice]);

  // Validate + normalize the link on the server as the user types (debounced).
  useEffect(() => {
    const raw = url.trim();
    if (!raw) {
      setCheck(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        setCheck(await api<LinkCheck>('/api/links/check', { body: { url: raw } }));
      } catch (e) {
        setCheck({ ok: false, error: errorMessage(e) });
      } finally {
        setChecking(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [url]);

  const sendingStatus = liveSending ?? opts?.sending ?? null;
  const usage = liveUsage ?? opts?.usage ?? null;
  const settings = opts?.settings ?? null;
  const templates = opts?.templates ?? [];
  const activeTemplates = templates.filter((t) => t.active);
  const chosenTemplate = templateChoice === 'rotate' ? null : templates.find((t) => String(t.id) === templateChoice);
  useEffect(() => {
    if (opts && templateChoice !== 'rotate' && !chosenTemplate) setTemplateChoice('rotate');
  }, [opts, templateChoice, chosenTemplate]);

  // Which groups can be ticked: admins = every group on the active number; users = groups in chosen presets.
  const sendable = useMemo(() => new Set((opts?.groups ?? []).filter((g) => !g.readOnly).map((g) => g.id)), [opts]);
  const pickerGroups: Group[] = useMemo(() => {
    if (!opts) return [];
    if (isAdmin) return opts.groups;
    const ids = new Set<string>();
    const out: Group[] = [];
    for (const p of opts.presets) {
      if (!presetIds.has(p.id)) continue;
      for (const g of p.groups) {
        if (ids.has(g.id)) continue;
        ids.add(g.id);
        out.push({ id: g.id, name: g.name, readOnly: !g.available });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [opts, isAdmin, presetIds]);

  const validSelected = useMemo(
    () => new Set([...selected].filter((id) => sendable.has(id) && pickerGroups.some((g) => g.id === id))),
    [selected, sendable, pickerGroups],
  );

  const togglePreset = (id: number) => {
    if (!opts) return;
    const preset = opts.presets.find((p) => p.id === id);
    if (!preset) return;
    const next = new Set(presetIds);
    const groupIds = preset.groups.filter((g) => g.available !== false && sendable.has(g.id)).map((g) => g.id);
    const sel = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      // Remove groups that no other chosen preset still includes.
      const keep = new Set(opts.presets.filter((p) => next.has(p.id)).flatMap((p) => p.groups.map((g) => g.id)));
      for (const g of groupIds) if (!keep.has(g)) sel.delete(g);
    } else {
      next.add(id);
      for (const g of groupIds) sel.add(g);
    }
    setPresetIds(next);
    setSelected(sel);
  };

  const previewTemplate = chosenTemplate ?? (activeTemplates.length ? activeTemplates[previewSeed % activeTemplates.length] : undefined);
  const linkForPreview = check?.ok && check.url ? check.url : 'https://…';
  const previewText = previewTemplate ? renderTemplate(previewTemplate.body, linkForPreview) : linkForPreview;

  const count = validSelected.size;
  const eta = settings ? formatDuration(estimateSeconds(count, settings)) : '';
  const remainingToday = usage ? Math.max(0, usage.cap - usage.used) : Infinity;

  const liveJobs = Object.values(live.jobs)
    .filter(
      (j) =>
        (j.status === 'queued' || j.status === 'running' || j.status === 'waiting' || myJobIds.includes(j.id)) &&
        (isAdmin || j.userId === live.me.id),
    )
    .sort((a, b) => a.id - b.id);

  const paused = !!sendingStatus && !sendingStatus.accepting;
  let blocker = '';
  if (paused) blocker = pauseText(sendingStatus!.reason, isAdmin);
  else if (!url.trim()) blocker = 'Paste a link to start.';
  else if (checking) blocker = 'Checking the link…';
  else if (check && !check.ok) blocker = check.error ?? 'That link can’t be sent.';
  else if (count === 0) blocker = isAdmin ? 'Choose at least one group.' : 'Choose a group list, then the groups to send to.';
  const canSend = !blocker && !!check?.ok && !sending;

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error('The clipboard is empty. Copy the post link first.');
        return;
      }
      setUrl(text.trim());
    } catch {
      toast.error('The browser blocked pasting. Click in the box and press Ctrl+V (or long-press → Paste).');
      urlRef.current?.focus();
    }
  };

  const doSend = async (confirmDuplicate: boolean) => {
    if (!check?.ok || !check.url) return;
    setSending(true);
    try {
      const r = await api<{ job: Job }>('/api/jobs', {
        body: {
          url: check.url,
          groupIds: [...validSelected],
          presetIds: [...presetIds],
          templateId: chosenTemplate ? chosenTemplate.id : null,
          confirmDuplicate,
        },
      });
      upsertJob(r.job);
      setMyJobIds((ids) => [...ids, r.job.id]);
      setUrl('');
      setDuplicate(null);
      toast.success(`Sending to ${plural(r.job.total, 'group')}. You can leave this page; it keeps going.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.duplicate) {
        setDuplicate(e.data.duplicate as { at: number; groups: number; by: string });
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSend) void doSend(false);
  };

  if (loadError) {
    return (
      <div className="card p-6 text-center">
        <p className="font-semibold">Couldn’t load the send page</p>
        <p className="hint mt-1">{loadError}</p>
        <button type="button" className="btn-primary mt-4" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!opts) return <p className="py-10 text-center text-muted">Loading…</p>;

  const noPresets = !isAdmin && opts.presets.length === 0;

  return (
    <div className="space-y-4">
      {liveJobs.map((j) => (
        <JobProgress key={j.id} job={j} settings={settings} />
      ))}

      <form onSubmit={onSubmit} className="space-y-4" aria-label="Send a link">
        {/* 1. Link */}
        <section className="card p-4 sm:p-5">
          <label htmlFor="url" className="mb-2 block text-lg font-bold">
            1. Post link
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={urlRef}
                id="url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                className="field min-h-14 pr-10 text-lg"
                placeholder="https://youtu.be/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-describedby="url-status"
                aria-invalid={!!check && !check.ok}
              />
              {url && (
                <button
                  type="button"
                  className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface"
                  onClick={() => {
                    setUrl('');
                    urlRef.current?.focus();
                  }}
                  aria-label="Clear link"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <button type="button" className="btn-quiet min-h-14 shrink-0" onClick={paste}>
              <ClipboardPaste className="size-5" aria-hidden />
              <span className="hidden sm:inline">Paste</span>
              <span className="sr-only sm:hidden">Paste link</span>
            </button>
          </div>
          <div id="url-status" aria-live="polite" className="mt-3 min-h-6">
            {check?.ok && check.platform && (
              <div className="flex items-center gap-2.5">
                <span className="shrink-0">
                  <PlatformIcon platform={check.platform} />
                </span>
                <span className="shrink-0 font-semibold whitespace-nowrap">{PLATFORM_NAME[check.platform]} link</span>
                <span className="min-w-0 truncate text-sm text-muted" title={check.url}>
                  {check.url}
                </span>
              </div>
            )}
            {check && !check.ok && <p className="text-sm text-bad">{check.error}</p>}
            {!check && <p className="hint">Facebook, TikTok and YouTube links work, including short links.</p>}
            {check?.ok && check.previous && (
              <p className="mt-2 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Already sent on {formatDateTime(check.previous.at)} by {check.previous.by}
                {check.previous.groups ? ` to ${plural(check.previous.groups, 'group')}` : ''}. You’ll be asked to confirm before sending it again.
              </p>
            )}
          </div>
        </section>

        {/* 2. Message */}
        <section className="card p-4 sm:p-5">
          <label htmlFor="template" className="mb-2 block text-lg font-bold">
            2. Message
          </label>
          <select id="template" className="field" value={templateChoice} onChange={(e) => setTemplateChoice(e.target.value)}>
            <option value="rotate">Mix it up ({plural(activeTemplates.length, 'template')} in turn)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                Always use: {t.name}
              </option>
            ))}
          </select>
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold">Preview{templateChoice === 'rotate' ? ' (one example)' : ''}</span>
              {templateChoice === 'rotate' && activeTemplates.length > 1 && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-accent"
                  onClick={() => setPreviewSeed((n) => n + 1)}
                >
                  <Shuffle className="size-4" aria-hidden /> Another example
                </button>
              )}
            </div>
            <div aria-live="polite">
              <ChatBubble text={previewText} />
            </div>
          </div>
        </section>

        {/* 3. Groups */}
        <section className="card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">3. Groups</h2>
            <span className="text-sm font-semibold text-accent" aria-live="polite">
              {count} selected
            </span>
          </div>

          {noPresets ? (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
              You don’t have any group lists yet. Ask your admin to give you access to one.
            </p>
          ) : (
            <>
              {opts.presets.length > 0 && (
                <fieldset className="mb-4">
                  <legend className="mb-2 text-sm font-semibold">{isAdmin ? 'Quick select a preset' : 'Your group lists'}</legend>
                  <div className="flex flex-wrap gap-2">
                    {opts.presets.map((p) => {
                      const on = presetIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => togglePreset(p.id)}
                          className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                            on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface hover:border-accent hover:text-accent'
                          }`}
                        >
                          {on && <Check className="size-4" aria-hidden />}
                          {p.name} <span className="font-normal opacity-75">· {p.groups.length}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {!isAdmin && presetIds.size === 0 ? (
                <p className="hint">Choose one or more lists above. All their groups get selected; untick any you want to skip.</p>
              ) : (
                <GroupPicker groups={pickerGroups} selected={validSelected} onChange={setSelected} />
              )}
            </>
          )}
        </section>

        {/* Send bar */}
        <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] z-10">
          <div className="card flex flex-col gap-2 p-3 shadow-lg sm:flex-row sm:items-center sm:p-4">
            <div className="min-w-0 flex-1 text-sm" aria-live="polite">
              {blocker ? (
                <span className={paused ? 'font-semibold text-bad' : 'text-muted'}>{blocker}</span>
              ) : (
                <span>
                  Takes about <strong>{eta}</strong> for {plural(count, 'group')}.{' '}
                  {count > remainingToday && <span className="text-warn">Only {remainingToday} more allowed today; the rest go out tomorrow.</span>}
                </span>
              )}
            </div>
            <button type="submit" className="btn-primary min-h-13 text-lg sm:min-w-56" disabled={!canSend}>
              <SendIcon className="size-5" aria-hidden />
              {sending ? 'Saving…' : count ? `Send to ${plural(count, 'group')}` : 'Send'}
              {count > 0 && !sending && !blocker && <span className="font-normal opacity-85">· ~{eta}</span>}
            </button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={!!duplicate}
        title="Send this link again?"
        body={
          duplicate && (
            <>
              This link was already sent on <strong>{formatDateTime(duplicate.at)}</strong> by {duplicate.by}
              {duplicate.groups ? ` and reached ${plural(duplicate.groups, 'group')}` : ''}. Sending the same link twice can annoy members and
              increases the risk of the number being blocked.{' '}
              <button type="button" className="font-semibold text-accent underline" onClick={onShowHistory}>
                See history
              </button>
            </>
          )
        }
        confirmLabel="Send again anyway"
        onConfirm={() => void doSend(true)}
        onCancel={() => setDuplicate(null)}
      />
    </div>
  );
}
