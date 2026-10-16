import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { GroupPicker } from '../components/GroupPicker';
import { plural } from '../format';
import { useApp } from '../store';
import type { Preset, SafetySettings, Template } from '../types';

export function Settings() {
  return (
    <div className="space-y-4">
      <UsageCard />
      <SafetyCard />
      <TemplatesCard />
      <PresetsCard />
    </div>
  );
}

function UsageCard() {
  const { state } = useApp();
  const { used, cap } = state.usage;
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const tone = pct >= 100 ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-accent';
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="usage-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="usage-title" className="text-lg font-bold">
          Today
        </h2>
        <span className="text-sm text-muted">{state.timeZone}</span>
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums">
        {used} <span className="text-lg font-semibold text-muted">of {cap} messages</span>
      </p>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={used}
        aria-label="Messages sent today"
      >
        <div className={`h-full ${tone} transition-[width]`} style={{ width: `${pct}%` }} />
      </div>
      <p className="hint mt-2">
        {used >= cap
          ? 'The daily limit is reached. Waiting sends continue tomorrow.'
          : `${cap - used} more can go out today. The count restarts at midnight.`}
      </p>
    </section>
  );
}

function SafetyCard() {
  const { state, setSettings } = useApp();
  const [form, setForm] = useState<SafetySettings>(state.settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(state.settings), [state.settings]);
  const dirty = JSON.stringify(form) !== JSON.stringify(state.settings);

  const num = (k: keyof SafetySettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value === '' ? 0 : Number(e.target.value) }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ settings: SafetySettings }>('/api/settings', { method: 'PUT', body: form });
      setSettings(r.settings);
      toast.success('Safety settings saved.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    try {
      const r = await api<{ settings: SafetySettings }>('/api/settings/reset', { body: {} });
      setSettings(r.settings);
      toast.success('Back to the values from the .env file.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="safety-title">
      <h2 id="safety-title" className="flex items-center gap-2 text-lg font-bold">
        <ShieldCheck className="size-5 text-accent" aria-hidden /> Safety
      </h2>
      <p className="hint mt-1">
        These rules make sending look like a person, which lowers the chance of WhatsApp blocking the number. They are enforced
        by the server for everyone.
      </p>
      <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
        <fieldset className="sm:col-span-2">
          <legend className="label">Pause between groups (seconds)</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="min" className="hint mb-1 block">
                Shortest
              </label>
              <input id="min" type="number" min={5} max={3600} className="field" value={form.minDelaySeconds} onChange={num('minDelaySeconds')} required />
            </div>
            <div>
              <label htmlFor="max" className="hint mb-1 block">
                Longest
              </label>
              <input id="max" type="number" min={5} max={3600} className="field" value={form.maxDelaySeconds} onChange={num('maxDelaySeconds')} required />
            </div>
          </div>
          <p className="hint mt-1.5">A random pause in this range is used each time. 15 to 40 seconds is a safe start.</p>
        </fieldset>

        <div>
          <label htmlFor="cap" className="label">
            Daily limit (messages)
          </label>
          <input id="cap" type="number" min={1} max={10000} className="field" value={form.dailyCap} onChange={num('dailyCap')} required />
        </div>

        <fieldset>
          <legend className="label">Sending hours</legend>
          <div className="flex items-center gap-2">
            <label htmlFor="ws" className="sr-only">
              From
            </label>
            <input id="ws" type="time" className="field" value={form.windowStart} onChange={(e) => setForm((f) => ({ ...f, windowStart: e.target.value }))} required />
            <span className="text-muted">to</span>
            <label htmlFor="we" className="sr-only">
              Until
            </label>
            <input id="we" type="time" className="field" value={form.windowEnd} onChange={(e) => setForm((f) => ({ ...f, windowEnd: e.target.value }))} required />
          </div>
          <p className="hint mt-1.5">Sends outside these hours wait and start automatically.</p>
        </fieldset>

        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={reset}>
            Use .env defaults
          </button>
          <button type="submit" className="btn-primary" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

function TemplatesCard() {
  const { state, setTemplates } = useApp();
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);

  const toggleActive = async (t: Template) => {
    try {
      const r = await api<{ templates: Template[] }>(`/api/templates/${t.id}`, { method: 'PUT', body: { ...t, active: !t.active } });
      setTemplates(r.templates);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!deleting) return;
    try {
      const r = await api<{ templates: Template[] }>(`/api/templates/${deleting.id}`, { method: 'DELETE' });
      setTemplates(r.templates);
      toast.success('Template deleted.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="tpl-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="tpl-title" className="text-lg font-bold">
          Message templates
        </h2>
        <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setEditing({ name: '', body: '{url}', active: true })}>
          <Plus className="size-4" aria-hidden /> New
        </button>
      </div>
      <p className="hint mt-1">
        <code className="rounded bg-surface-2 px-1">{'{url}'}</code> is replaced by the link. Ticked templates are mixed when
        “Mix it up” is chosen.
      </p>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line" role="list">
        {state.templates.map((t) => (
          <li key={t.id} className="flex items-start gap-3 p-3">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-(--accent)"
              checked={t.active}
              onChange={() => void toggleActive(t)}
              aria-label={`Use “${t.name}” when mixing messages`}
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t.name}</p>
              <p className="line-clamp-2 text-sm break-words whitespace-pre-wrap text-muted">{t.body}</p>
            </div>
            <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-surface-2" onClick={() => setEditing(t)} aria-label={`Edit “${t.name}”`}>
              <Pencil className="size-4" />
            </button>
            <button type="button" className="grid size-10 place-items-center rounded-lg text-bad hover:bg-bad-soft" onClick={() => setDeleting(t)} aria-label={`Delete “${t.name}”`}>
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <TemplateDialog
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={(list) => {
          setTemplates(list);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete this template?"
        body={<>“{deleting?.name}” will be removed. Past sends are not affected.</>}
        confirmLabel="Delete"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

function TemplateDialog({
  value,
  onClose,
  onSaved,
}: {
  value: Partial<Template> | null;
  onClose: () => void;
  onSaved: (t: Template[]) => void;
}) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(value?.name ?? '');
    setBody(value?.body ?? '{url}');
  }, [value]);
  const missingUrl = !body.includes('{url}');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { name: name.trim(), body, active: value?.active ?? true };
      const r = value?.id
        ? await api<{ templates: Template[] }>(`/api/templates/${value.id}`, { method: 'PUT', body: payload })
        : await api<{ templates: Template[] }>('/api/templates', { body: payload });
      onSaved(r.templates);
      toast.success('Template saved.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!value} title={value?.id ? 'Edit template' : 'New template'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="tpl-name" className="label">
            Name
          </label>
          <input id="tpl-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </div>
        <div>
          <label htmlFor="tpl-body" className="label">
            Message
          </label>
          <textarea
            id="tpl-body"
            className="field min-h-32 py-2.5"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            required
            aria-describedby="tpl-help"
            aria-invalid={missingUrl}
          />
          <p id="tpl-help" className={`mt-1.5 text-sm ${missingUrl ? 'text-bad' : 'text-muted'}`}>
            {missingUrl ? 'Add {url} where the link should appear.' : 'Emoji and line breaks are fine.'}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || missingUrl}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PresetsCard() {
  const { state, setPresets } = useApp();
  const [editing, setEditing] = useState<Preset | null>(null);
  const [deleting, setDeleting] = useState<Preset | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      const r = await api<{ presets: Preset[] }>(`/api/presets/${deleting.id}`, { method: 'DELETE' });
      setPresets(r.presets);
      toast.success('Group list deleted.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="presets-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="presets-title" className="text-lg font-bold">
          Saved group lists
        </h2>
        <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setEditing({ id: 0, name: '', groupIds: [] })}>
          <Plus className="size-4" aria-hidden /> New
        </button>
      </div>
      {state.presets.length === 0 ? (
        <p className="hint mt-2">No lists yet. Select groups on the Send tab and choose “Save these groups as a list”, or press New.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line" role="list">
          {state.presets.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="text-sm text-muted">{plural(p.groupIds.length, 'group')}</p>
              </div>
              <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-surface-2" onClick={() => setEditing(p)} aria-label={`Edit “${p.name}”`}>
                <Pencil className="size-4" />
              </button>
              <button type="button" className="grid size-10 place-items-center rounded-lg text-bad hover:bg-bad-soft" onClick={() => setDeleting(p)} aria-label={`Delete “${p.name}”`}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <PresetDialog
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={(list) => {
          setPresets(list);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete this group list?"
        body={<>“{deleting?.name}” will be removed. The WhatsApp groups themselves are not touched.</>}
        confirmLabel="Delete"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

function PresetDialog({ value, onClose, onSaved }: { value: Preset | null; onClose: () => void; onSaved: (p: Preset[]) => void }) {
  const { state } = useApp();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(value?.name ?? '');
    setSelected(new Set(value?.groupIds ?? []));
  }, [value]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: name.trim(), groupIds: [...selected] };
      const r = value?.id
        ? await api<{ presets: Preset[] }>(`/api/presets/${value.id}`, { method: 'PUT', body })
        : await api<{ presets: Preset[] }>('/api/presets', { body });
      onSaved(r.presets);
      toast.success('Group list saved.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!value} title={value?.id ? 'Edit group list' : 'New group list'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="preset-edit-name" className="label">
            Name
          </label>
          <input id="preset-edit-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="e.g. All partners" />
        </div>
        <div>
          <p className="label">
            Groups <span className="font-normal text-muted">({selected.size} selected)</span>
          </p>
          <GroupPicker groups={state.groups} selected={selected} onChange={setSelected} maxHeight="max-h-64" />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || selected.size === 0}>
            Save list
          </button>
        </div>
      </form>
    </Dialog>
  );
}
