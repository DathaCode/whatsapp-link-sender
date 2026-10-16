import { AlertTriangle, Check, Eraser, ImagePlus, Link2, Loader2, RefreshCw, Send as SendIcon, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError, api, errorMessage, uploadFile } from '../api';
import { ChatBubble } from '../components/ChatBubble';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { GroupPicker, sharedCommunityWarning } from '../components/GroupPicker';
import { JobProgress } from '../components/JobProgress';
import { Badge } from '../components/StatusBadge';
import { estimateSeconds, formatBytes, formatDateTime, formatDuration, pauseText, plural } from '../format';
import { useLive } from '../store';
import type { Analysis, Duplicate, Group, ImageInfo, Job, SendOptions } from '../types';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const imageUrl = (id: string) => `/api/uploads/${id}`;

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

  // ---------------- message + attachment (autosaved draft) ----------------
  const [text, setText] = useState('');
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [checking, setChecking] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ draft: { text: string; uploadId: string | null; updatedAt: number | null }; image: ImageInfo | null }>('/api/drafts')
      .then((r) => {
        setText(r.draft.text);
        setImage(r.image);
        setSavedAt(r.draft.updatedAt);
      })
      .catch(() => {})
      .finally(() => setDraftLoaded(true));
  }, []);

  // Autosave (server-side, per user) a second after the last change.
  useEffect(() => {
    if (!draftLoaded) return;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ draft: { updatedAt: number } }>('/api/drafts', { method: 'PUT', body: { text, uploadId: image?.id ?? null } });
        setSavedAt(r.draft.updatedAt);
      } catch {
        /* keep typing; the next change retries */
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [text, image, draftLoaded]);

  // Live check: exactly what would be sent, links, limits, duplicates (the server is the source of truth).
  useEffect(() => {
    if (!text.trim()) {
      setAnalysis(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        setAnalysis(await api<Analysis>('/api/messages/check', { body: { text, uploadId: image?.id ?? null } }));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) toast.error(errorMessage(e));
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [text, image]);

  const addImage = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      if (!IMAGE_TYPES.includes(file.type)) {
        toast.error('Only JPG, PNG or WebP images can be attached.');
        return;
      }
      if (opts && file.size > opts.limits.imageBytes) {
        toast.error(`That image is ${formatBytes(file.size)}. The limit is 5 MB.`);
        return;
      }
      setUploading(true);
      try {
        const r = await uploadFile<{ image: ImageInfo }>('/api/uploads', file);
        setImage(r.image);
        toast.success('Image attached.');
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setUploading(false);
      }
    },
    [opts],
  );

  // Ctrl+V anywhere on the page: an image on the clipboard is attached (text pastes as usual).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      void addImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImage]);

  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addImage(e.dataTransfer.files?.[0]);
  };

  const insertSnippet = (body: string) => {
    const el = textRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    // Keep the snippet in its own paragraph.
    const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const trail = after && !after.startsWith('\n') ? '\n\n' : '';
    setText(before + lead + body + trail + after);
    requestAnimationFrame(() => {
      const pos = (before + lead + body).length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const clearAll = async () => {
    setText('');
    setImage(null);
    setAnalysis(null);
    try {
      await api('/api/drafts', { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    textRef.current?.focus();
  };

  // ---------------- groups ----------------
  const [presetIds, setPresetIds] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sendable = useMemo(() => new Set((opts?.groups ?? []).filter((g) => !g.readOnly).map((g) => g.id)), [opts]);
  const pickerGroups: Group[] = useMemo(() => {
    if (!opts) return [];
    if (isAdmin) return opts.groups;
    const liveGroups = new Map(opts.groups.map((g) => [g.id, g]));
    const ids = new Set<string>();
    const out: Group[] = [];
    for (const p of opts.presets) {
      if (!presetIds.has(p.id)) continue;
      for (const g of p.groups) {
        if (ids.has(g.id)) continue;
        ids.add(g.id);
        out.push(liveGroups.get(g.id) ?? { id: g.id, name: g.name, readOnly: true, reason: 'Not available on the current WhatsApp number' });
      }
    }
    return out;
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
      const keep = new Set(opts.presets.filter((p) => next.has(p.id)).flatMap((p) => p.groups.map((g) => g.id)));
      for (const g of groupIds) if (!keep.has(g)) sel.delete(g);
    } else {
      next.add(id);
      for (const g of groupIds) sel.add(g);
    }
    setPresetIds(next);
    setSelected(sel);
  };

  // ---------------- sending ----------------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [linkHosts, setLinkHosts] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);
  const [myJobIds, setMyJobIds] = useState<number[]>([]);
  const [pendingFlags, setPendingFlags] = useState<{ confirmDuplicate?: boolean; confirmLinks?: boolean }>({});

  const sendingStatus = liveSending ?? opts?.sending ?? null;
  const usage = liveUsage ?? opts?.usage ?? null;
  const settings = opts?.settings ?? null;
  const count = validSelected.size;
  const eta = settings ? formatDuration(estimateSeconds(count, settings, !!image)) : '';
  const weight = image && settings?.imageSendMode === 'two' ? 2 : 1;
  const remainingToday = usage ? Math.max(0, Math.floor((usage.cap - usage.used) / weight)) : Infinity;
  const limit = analysis?.limit ?? (image && settings?.imageSendMode !== 'two' ? (opts?.limits.caption ?? 1024) : (opts?.limits.text ?? 65536));
  const chars = analysis?.chars ?? [...text.trim()].length;
  const blockedLinks = !isAdmin && (analysis?.disallowed.length ?? 0) > 0;

  const liveJobs = Object.values(live.jobs)
    .filter(
      (j) => (j.status === 'queued' || j.status === 'running' || j.status === 'waiting' || myJobIds.includes(j.id)) && (isAdmin || j.userId === live.me.id),
    )
    .sort((a, b) => a.id - b.id);

  const paused = !!sendingStatus && !sendingStatus.accepting;
  let blocker = '';
  if (paused) blocker = pauseText(sendingStatus!.reason, isAdmin);
  else if (!text.trim()) blocker = 'Write or paste your message to start.';
  else if (checking || !analysis) blocker = 'Checking the message…';
  else if (analysis.imageError) blocker = analysis.imageError;
  else if (analysis.tooLong) blocker = `The message is too long: ${analysis.chars.toLocaleString()} of ${analysis.limit.toLocaleString()} characters.`;
  else if (blockedLinks) blocker = `Remove links that aren’t allowed: ${analysis.disallowed.join(', ')}.`;
  else if (uploading) blocker = 'Uploading the image…';
  else if (count === 0) blocker = isAdmin ? 'Choose at least one group.' : 'Choose a group list, then the groups to send to.';
  const canSend = !blocker && !sending;

  const doSend = async (flags: { confirmDuplicate?: boolean; confirmLinks?: boolean }) => {
    setSending(true);
    try {
      const r = await api<{ job: Job }>('/api/jobs', {
        body: { text, uploadId: image?.id ?? null, groupIds: [...validSelected], presetIds: [...presetIds], ...flags },
      });
      upsertJob(r.job);
      setMyJobIds((ids) => [...ids, r.job.id]);
      setConfirmOpen(false);
      setDuplicate(null);
      setLinkHosts(null);
      setText('');
      setImage(null);
      setAnalysis(null);
      toast.success(`Sending to ${plural(r.job.total, 'group')}. You can leave this page; it keeps going.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.duplicate) {
        setConfirmOpen(false);
        setLinkHosts(null);
        setDuplicate(e.data.duplicate as Duplicate);
      } else if (e instanceof ApiError && e.code === 'links_need_confirmation') {
        setConfirmOpen(false);
        setLinkHosts((e.data.hosts as string[]) ?? []);
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setPendingFlags({});
    setConfirmOpen(true);
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
  if (!opts || !draftLoaded) return <p className="py-10 text-center text-muted">Loading…</p>;

  const noPresets = !isAdmin && opts.presets.length === 0;
  const previewText = analysis?.text ?? text.trim();
  const previewLinks = analysis?.links.map((l) => l.cleaned) ?? [];
  const shared = sharedCommunityWarning(pickerGroups, validSelected);

  return (
    <div className="space-y-4">
      {liveJobs.map((j) => (
        <JobProgress key={j.id} job={j} settings={settings} />
      ))}

      <form onSubmit={onSubmit} className="space-y-4" aria-label="Send a message">
        {/* 1. Message */}
        <section className="card p-4 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="message" className="text-lg font-bold">
              1. Message
            </label>
            <span className="text-xs text-muted" aria-live="polite">
              {savedAt ? `Draft saved ${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(savedAt))}` : ''}
            </span>
          </div>
          <textarea
            id="message"
            ref={textRef}
            className="field font-message min-h-64 resize-y py-3 text-[15px] leading-relaxed"
            placeholder={'Write or paste the full post here: text, links and emoji.\n\nRead more>>> https://hiru.lk/…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-describedby="message-help message-count"
            aria-invalid={!!analysis?.tooLong || blockedLinks}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p id="message-help" className="hint">
              Sent exactly as typed. Use *bold*, _italic_ and ~strike~ like in WhatsApp.
            </p>
            <span id="message-count" className={`text-sm tabular-nums ${chars > limit ? 'font-semibold text-bad' : 'text-muted'}`}>
              {chars.toLocaleString()} / {limit.toLocaleString()}
            </span>
          </div>

          {opts.snippets.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-sm font-semibold">Insert at the cursor</p>
              <div className="flex flex-wrap gap-2">
                {opts.snippets.map((s) => (
                  <button key={s.id} type="button" className="btn-quiet min-h-9 px-3.5 text-sm" onClick={() => insertSnippet(s.body)} title={s.body}>
                    + {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {analysis && analysis.links.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                <Link2 className="size-4 text-muted" aria-hidden /> Links in this message
              </p>
              <ul className="flex flex-wrap gap-2" role="list">
                {analysis.links.map((l, i) => (
                  <li key={`${l.cleaned}-${i}`} title={l.original !== l.cleaned ? `Tracking removed:\n${l.original}\n→ ${l.cleaned}` : l.cleaned}>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${l.allowed ? 'border-line' : 'border-bad/50 bg-bad-soft text-bad'}`}
                    >
                      <span className="font-semibold">{l.host}</span>
                      <Badge tone={l.allowed ? 'ok' : 'bad'}>{l.allowed ? 'allowed' : 'not allowed'}</Badge>
                      {!l.main && <span className="text-xs text-muted">footer</span>}
                      {l.original !== l.cleaned && <span className="text-xs text-muted">cleaned</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {analysis.disallowed.length > 0 && (
                <p className="mt-2 text-sm text-bad">
                  {isAdmin
                    ? `Links to ${analysis.disallowed.join(', ')} are outside the allowed sites. You’ll be asked to confirm.`
                    : `Links to ${analysis.disallowed.join(', ')} can’t be sent. Remove them, or ask an admin to allow the site.`}
                </p>
              )}
            </div>
          )}
        </section>

        {/* 2. Attachment */}
        <section
          className={`card p-4 sm:p-5 ${dragging ? 'ring-2 ring-accent' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          aria-labelledby="attach-title"
        >
          <h2 id="attach-title" className="mb-2 text-lg font-bold">
            2. Image <span className="text-sm font-normal text-muted">(optional)</span>
          </h2>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const input = e.target;
              void addImage(input.files?.[0]).finally(() => (input.value = ''));
            }}
          />
          {image ? (
            <div className="flex flex-wrap items-center gap-4">
              <img src={imageUrl(image.id)} alt="Attached image" className="size-28 rounded-lg object-cover ring-1 ring-line" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">{image.originalName}</p>
                <p className="text-muted">
                  {image.width}×{image.height} · {formatBytes(image.size)} (re-encoded, metadata removed)
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <RefreshCw className="size-4" aria-hidden /> Replace
                  </button>
                  <button type="button" className="btn-danger min-h-9 px-3 text-sm" onClick={() => setImage(null)} disabled={uploading}>
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-center text-muted hover:border-accent hover:text-accent"
            >
              {uploading ? <Loader2 className="size-7 animate-spin" aria-hidden /> : <ImagePlus className="size-7" aria-hidden />}
              <span className="font-semibold text-ink">{uploading ? 'Uploading…' : 'Add an image'}</span>
              <span className="text-sm">Drag it here, click to choose, or press Ctrl+V to paste. JPG, PNG or WebP, up to 5 MB.</span>
            </button>
          )}
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
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">You don’t have any group lists yet. Ask your admin to give you access to one.</p>
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
              {shared.map((w) => (
                <p key={w.community} role="status" className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <strong>These groups share members.</strong> {w.count} of the selected groups are in the “{w.community}” Community, so people may get this
                    post more than once.
                  </span>
                </p>
              ))}
            </>
          )}
        </section>

        {/* Preview */}
        <section className="card p-4 sm:p-5" aria-labelledby="preview-title">
          <h2 id="preview-title" className="mb-2 text-lg font-bold">
            Preview
          </h2>
          {previewText || image ? (
            <>
              <ChatBubble text={previewText} links={previewLinks} imageUrl={image ? imageUrl(image.id) : null} />
              <p className="hint mt-2">
                {image
                  ? settings?.imageSendMode === 'two'
                    ? 'The image is sent first, then the text as its own message, so WhatsApp shows a preview card for the first link.'
                    : 'Links show as plain links (no preview card) because an image is attached.'
                  : 'WhatsApp will show a preview card for the first link.'}
              </p>
              {analysis?.duplicate && (
                <p className="mt-2 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Looks like a post sent on {formatDateTime(analysis.duplicate.at)} by {analysis.duplicate.by} ({analysis.duplicate.reasons.join('; ')}). You’ll be
                  asked to confirm.
                </p>
              )}
            </>
          ) : (
            <p className="hint">Your message will appear here as it will look in WhatsApp.</p>
          )}
        </section>

        {/* Send bar */}
        <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] z-10">
          <div className="card flex flex-col gap-2 p-3 shadow-lg sm:flex-row sm:items-center sm:p-4">
            <div className="min-w-0 flex-1 text-sm" aria-live="polite">
              {blocker ? (
                <span className={paused || analysis?.tooLong || blockedLinks ? 'font-semibold text-bad' : 'text-muted'}>{blocker}</span>
              ) : (
                <span>
                  About <strong>{eta}</strong> for {plural(count, 'group')}
                  {image ? ' (longer pauses for images)' : ''}.{' '}
                  {count > remainingToday && <span className="text-warn">Only {remainingToday} more allowed today; the rest go out tomorrow.</span>}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-quiet" onClick={() => void clearAll()} disabled={!text && !image}>
                <Eraser className="size-4" aria-hidden /> Clear
              </button>
              <button type="submit" className="btn-primary min-h-12 flex-1 sm:min-w-52 sm:flex-none" disabled={!canSend}>
                <SendIcon className="size-5" aria-hidden />
                {count ? `Send to ${plural(count, 'group')}` : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Confirm before sending */}
      <Dialog open={confirmOpen} title={`Send to ${plural(count, 'group')}?`} onClose={() => setConfirmOpen(false)} wide>
        <ChatBubble text={previewText} links={previewLinks} imageUrl={image ? imageUrl(image.id) : null} />
        <ul className="mt-3 space-y-1 text-sm text-muted">
          <li>
            {plural(count, 'group')} · about {eta}
            {image ? ` · ${settings?.imageSendMode === 'two' ? 'image, then text (2 messages per group)' : 'image with the text as caption'}` : ''}
          </li>
          {analysis?.links.some((l) => l.original !== l.cleaned) && <li>Tracking parameters were removed from links.</li>}
        </ul>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={() => setConfirmOpen(false)} autoFocus>
            Back
          </button>
          <button type="button" className="btn-primary" disabled={sending} onClick={() => void doSend(pendingFlags)}>
            <Upload className="size-4" aria-hidden /> {sending ? 'Sending…' : 'Send now'}
          </button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!linkHosts}
        title="Send links outside the allowed sites?"
        body={
          <>
            This message links to <strong>{linkHosts?.join(', ')}</strong>, which {linkHosts && linkHosts.length > 1 ? 'are' : 'is'} not on the allowed list. Users can’t
            send these; as an admin you can. Your confirmation is recorded in the audit log.
          </>
        }
        confirmLabel="Send anyway"
        onConfirm={() => {
          const flags = { ...pendingFlags, confirmLinks: true };
          setPendingFlags(flags);
          void doSend(flags);
        }}
        onCancel={() => setLinkHosts(null)}
      />

      <ConfirmDialog
        open={!!duplicate}
        title="Send this again?"
        body={
          duplicate && (
            <>
              A similar post was sent on <strong>{formatDateTime(duplicate.at)}</strong> by {duplicate.by}
              {duplicate.groups ? ` to ${plural(duplicate.groups, 'group')}` : ''}: {duplicate.reasons.join('; ')}. Sending the same post twice can annoy members and
              increases the risk of the number being blocked.{' '}
              <button type="button" className="font-semibold text-accent underline" onClick={onShowHistory}>
                See history
              </button>
            </>
          )
        }
        confirmLabel="Send again anyway"
        onConfirm={() => {
          const flags = { ...pendingFlags, confirmDuplicate: true };
          setPendingFlags(flags);
          void doSend(flags);
        }}
        onCancel={() => setDuplicate(null)}
      />
    </div>
  );
}
