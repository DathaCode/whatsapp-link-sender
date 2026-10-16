import { AlertTriangle, ClipboardPaste, Info, Save, Send as SendIcon, Shuffle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError, api, errorMessage } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { GroupPicker } from '../components/GroupPicker';
import { JobProgress } from '../components/JobProgress';
import { PlatformIcon } from '../components/PlatformIcon';
import { PLATFORM_NAME, estimateSeconds, formatDateTime, formatDuration, plural, renderTemplate } from '../format';
import { useApp } from '../store';
import type { Job, LinkCheck, Preset } from '../types';

const SELECTION_KEY = 'wls.selectedGroups';
const TEMPLATE_KEY = 'wls.template';

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

export function Send({ onShowHistory }: { onShowHistory: () => void }) {
  const { state, setPresets, upsertJob } = useApp();
  const { groups, presets, templates, settings, usage, whatsapp } = state;

  const [url, setUrl] = useState('');
  const [check, setCheck] = useState<LinkCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [templateChoice, setTemplateChoice] = useState<string>(() => loadLocal(TEMPLATE_KEY, 'rotate'));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(loadLocal<string[]>(SELECTION_KEY, [])));
  const [previewSeed, setPreviewSeed] = useState(0);
  const [sending, setSending] = useState(false);
  const [duplicate, setDuplicate] = useState<{ at: number; groups: number } | null>(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [recentJobId, setRecentJobId] = useState<number | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  // Forget selections for groups that no longer exist.
  const validSelected = useMemo(() => {
    const ok = new Set(groups.filter((g) => !g.readOnly).map((g) => g.id));
    return new Set([...selected].filter((id) => ok.has(id)));
  }, [selected, groups]);

  useEffect(() => saveLocal(SELECTION_KEY, [...selected]), [selected]);
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

  const activeTemplates = templates.filter((t) => t.active);
  const chosenTemplate = templateChoice === 'rotate' ? null : templates.find((t) => String(t.id) === templateChoice);
  useEffect(() => {
    if (templateChoice !== 'rotate' && !chosenTemplate) setTemplateChoice('rotate');
  }, [templateChoice, chosenTemplate]);

  const previewTemplate =
    chosenTemplate ?? (activeTemplates.length ? activeTemplates[previewSeed % activeTemplates.length] : undefined);
  const linkForPreview = check?.ok && check.url ? check.url : 'https://…';
  const previewText = previewTemplate ? renderTemplate(previewTemplate.body, linkForPreview) : linkForPreview;

  const count = validSelected.size;
  const eta = formatDuration(estimateSeconds(count, settings));
  const remainingToday = Math.max(0, usage.cap - usage.used);

  const liveJobs = Object.values(state.jobs)
    .filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'waiting' || j.id === recentJobId)
    .sort((a, b) => a.id - b.id);

  const canSend = !!check?.ok && count > 0 && !sending;
  let blocker = '';
  if (!url.trim()) blocker = 'Paste a link to start.';
  else if (checking) blocker = 'Checking the link…';
  else if (check && !check.ok) blocker = check.error ?? 'That link can’t be sent.';
  else if (count === 0) blocker = 'Choose at least one group.';

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
          templateId: chosenTemplate ? chosenTemplate.id : null,
          confirmDuplicate,
        },
      });
      upsertJob(r.job);
      setRecentJobId(r.job.id);
      setUrl('');
      setDuplicate(null);
      toast.success(
        whatsapp.state === 'ready'
          ? `Sending to ${plural(r.job.total, 'group')}. You can leave this page; it keeps going.`
          : `Saved. It will send to ${plural(r.job.total, 'group')} when WhatsApp is connected.`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.duplicate) {
        setDuplicate(e.data.duplicate as { at: number; groups: number });
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

  const applyPreset = (p: Preset) => {
    setSelected(new Set(p.groupIds));
    const missing = p.groupIds.filter((id) => !groups.some((g) => g.id === id && !g.readOnly)).length;
    toast.message(`Selected “${p.name}”`, {
      description: missing ? `${plural(missing, 'group')} from this list can’t be used any more and were skipped.` : undefined,
    });
  };

  return (
    <div className="space-y-4">
      {liveJobs.map((j) => (
        <JobProgress key={j.id} job={j} />
      ))}

      {whatsapp.state !== 'ready' && (
        <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          WhatsApp isn’t connected right now. You can still prepare a send. It will start when the connection is back.
        </p>
      )}

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
                This link was already used on {formatDateTime(check.previous.at)}
                {check.previous.groups ? ` (sent to ${plural(check.previous.groups, 'group')})` : ''}. You’ll be asked to confirm
                before sending it again.
              </p>
            )}
          </div>
        </section>

        {/* 2. Message */}
        <section className="card p-4 sm:p-5">
          <label htmlFor="template" className="mb-2 block text-lg font-bold">
            2. Message
          </label>
          <select
            id="template"
            className="field"
            value={templateChoice}
            onChange={(e) => setTemplateChoice(e.target.value)}
          >
            <option value="rotate">
              Mix it up ({plural(activeTemplates.length, 'template')} in turn)
            </option>
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
            <div className="rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-3 break-words whitespace-pre-wrap" aria-live="polite">
              {previewText}
            </div>
            <p className="hint mt-1.5">Using different wording each time looks more natural to WhatsApp. Edit templates in Settings.</p>
          </div>
        </section>

        {/* 3. Groups */}
        <section className="card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">3. Groups</h2>
            <span className="text-sm font-semibold text-accent" aria-live="polite">
              {count} of {groups.filter((g) => !g.readOnly).length} selected
            </span>
          </div>

          {presets.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-sm font-semibold">Saved group lists</p>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="min-h-10 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:border-accent hover:text-accent"
                  >
                    {p.name} <span className="font-normal text-muted">· {p.groupIds.length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <GroupPicker groups={groups} selected={validSelected} onChange={setSelected} />

          {count > 0 && (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent"
              onClick={() => setSavePresetOpen(true)}
            >
              <Save className="size-4" aria-hidden /> Save these {count} groups as a list
            </button>
          )}
        </section>

        {/* Send bar */}
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 md:bottom-4">
          <div className="card flex flex-col gap-2 p-3 shadow-lg sm:flex-row sm:items-center sm:p-4">
            <div className="min-w-0 flex-1 text-sm" aria-live="polite">
              {blocker ? (
                <span className="text-muted">{blocker}</span>
              ) : (
                <span>
                  Takes about <strong>{eta}</strong> for {plural(count, 'group')}.{' '}
                  {count > remainingToday && (
                    <span className="text-warn">
                      Only {remainingToday} more allowed today; the rest go out tomorrow.
                    </span>
                  )}
                </span>
              )}
            </div>
            <button type="submit" className="btn-primary min-h-13 text-lg sm:min-w-56" disabled={!canSend}>
              <SendIcon className="size-5" aria-hidden />
              {sending ? 'Saving…' : count ? `Send to ${plural(count, 'group')}` : 'Send'}
              {count > 0 && !sending && <span className="font-normal opacity-85">· ~{eta}</span>}
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
              This link was already used on <strong>{formatDateTime(duplicate.at)}</strong>
              {duplicate.groups ? ` and reached ${plural(duplicate.groups, 'group')}` : ''}. Sending the same link twice can annoy members and increases the risk of the
              number being blocked.{' '}
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

      <SavePresetDialog
        open={savePresetOpen}
        groupIds={[...validSelected]}
        presets={presets}
        onClose={() => setSavePresetOpen(false)}
        onSaved={(p) => {
          setPresets(p);
          setSavePresetOpen(false);
        }}
      />
    </div>
  );
}

function SavePresetDialog({
  open,
  groupIds,
  presets,
  onClose,
  onSaved,
}: {
  open: boolean;
  groupIds: string[];
  presets: Preset[];
  onClose: () => void;
  onSaved: (p: Preset[]) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = presets.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: name.trim(), groupIds };
      const r = existing
        ? await api<{ presets: Preset[] }>(`/api/presets/${existing.id}`, { method: 'PUT', body })
        : await api<{ presets: Preset[] }>('/api/presets', { body });
      onSaved(r.presets);
      toast.success(`Saved “${body.name}” with ${plural(groupIds.length, 'group')}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Save group list" onClose={onClose}>
      <form onSubmit={save}>
        <label htmlFor="preset-name" className="label">
          List name
        </label>
        <input
          id="preset-name"
          className="field"
          placeholder="e.g. Sinhala groups"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
          autoFocus
        />
        <p className="hint mt-2">
          {existing
            ? `A list called “${existing.name}” exists. Saving replaces its groups.`
            : `Saves the ${plural(groupIds.length, 'selected group')} so you can pick them with one tap.`}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {existing ? 'Replace list' : 'Save list'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
