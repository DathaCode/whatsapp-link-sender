import { DatabaseBackup, Download, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { formatDateTime } from '../format';
import type { SafetySettings, Template } from '../types';

export function Settings() {
  return (
    <div className="space-y-4">
      <SafetyCard />
      <TemplatesCard />
      <BackupsCard />
    </div>
  );
}

function SafetyCard() {
  const [saved, setSaved] = useState<SafetySettings | null>(null);
  const [form, setForm] = useState<SafetySettings | null>(null);
  const [meta, setMeta] = useState<{ timeZone: string; auditRetentionDays: number }>({ timeZone: '', auditRetentionDays: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: SafetySettings; timeZone: string; auditRetentionDays: number }>('/api/admin/settings').then(
      (r) => {
        setSaved(r.settings);
        setForm(r.settings);
        setMeta({ timeZone: r.timeZone, auditRetentionDays: r.auditRetentionDays });
      },
      (e) => toast.error(errorMessage(e)),
    );
  }, []);
  if (!form || !saved) return <p className="card p-5 text-muted">Loading…</p>;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const num = (k: keyof SafetySettings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => f && { ...f, [k]: e.target.value === '' ? 0 : Number(e.target.value) });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ settings: SafetySettings }>('/api/admin/settings', { method: 'PUT', body: form });
      setSaved(r.settings);
      setForm(r.settings);
      toast.success('Safety settings saved. The change is in the audit log.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    try {
      const r = await api<{ settings: SafetySettings }>('/api/admin/settings/reset', { body: {} });
      setSaved(r.settings);
      setForm(r.settings);
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
        These rules make sending look like a person and lower the chance of WhatsApp blocking the number. The server enforces them for everyone. Times use {meta.timeZone}.
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
        </fieldset>
        <div>
          <label htmlFor="cap" className="label">
            Daily limit per number (messages)
          </label>
          <input id="cap" type="number" min={1} max={10000} className="field" value={form.dailyCap} onChange={num('dailyCap')} required />
        </div>
        <fieldset>
          <legend className="label">Sending hours</legend>
          <div className="flex items-center gap-2">
            <label htmlFor="ws" className="sr-only">
              From
            </label>
            <input id="ws" type="time" className="field" value={form.windowStart} onChange={(e) => setForm((f) => f && { ...f, windowStart: e.target.value })} required />
            <span className="text-muted">to</span>
            <label htmlFor="we" className="sr-only">
              Until
            </label>
            <input id="we" type="time" className="field" value={form.windowEnd} onChange={(e) => setForm((f) => f && { ...f, windowEnd: e.target.value })} required />
          </div>
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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);

  useEffect(() => {
    api<{ templates: Template[] }>('/api/admin/templates').then((r) => setTemplates(r.templates), (e) => toast.error(errorMessage(e)));
  }, []);

  const toggle = async (t: Template) => {
    try {
      const r = await api<{ templates: Template[] }>(`/api/admin/templates/${t.id}`, { method: 'PUT', body: { ...t, active: !t.active } });
      setTemplates(r.templates);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!deleting) return;
    try {
      const r = await api<{ templates: Template[] }>(`/api/admin/templates/${deleting.id}`, { method: 'DELETE' });
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
        <code className="rounded bg-surface-2 px-1">{'{url}'}</code> is replaced by the link. Ticked templates are mixed when “Mix it up” is chosen.
      </p>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line" role="list">
        {templates.map((t) => (
          <li key={t.id} className="flex items-start gap-3 p-3">
            <input type="checkbox" className="mt-1 size-5 shrink-0 accent-(--accent)" checked={t.active} onChange={() => void toggle(t)} aria-label={`Use “${t.name}” when mixing messages`} />
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

function TemplateDialog({ value, onClose, onSaved }: { value: Partial<Template> | null; onClose: () => void; onSaved: (t: Template[]) => void }) {
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
        ? await api<{ templates: Template[] }>(`/api/admin/templates/${value.id}`, { method: 'PUT', body: payload })
        : await api<{ templates: Template[] }>('/api/admin/templates', { body: payload });
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
          <textarea id="tpl-body" className="field min-h-32 py-2.5" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} required aria-describedby="tpl-help" aria-invalid={missingUrl} />
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

interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

function BackupsCard() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [keep, setKeep] = useState(14);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ backups: BackupInfo[]; keep: number }>('/api/admin/backups');
      setBackups(r.backups);
      setKeep(r.keep);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ backup: BackupInfo; backups: BackupInfo[] }>('/api/admin/backups', { body: {} });
      setBackups(r.backups);
      toast.success('Backup created. Download it to keep a copy off the server.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="backup-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="backup-title" className="flex items-center gap-2 text-lg font-bold">
          <DatabaseBackup className="size-5 text-accent" aria-hidden /> Backups
        </h2>
        <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : 'Back up now'}
        </button>
      </div>
      <p className="hint mt-1">
        A copy of the database (users, history, presets, settings and the audit log) is made every night at 02:30. The newest {keep} are kept. WhatsApp logins are not included.
      </p>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm" role="list">
        {backups.length === 0 && <li className="p-3 text-muted">No backups yet.</li>}
        {backups.map((b) => (
          <li key={b.name} className="flex items-center gap-3 p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{formatDateTime(b.createdAt)}</span>
              <span className="text-muted">
                {(b.size / 1024).toFixed(0)} KB · {b.name.includes('manual') ? 'manual' : 'nightly'}
              </span>
            </span>
            <a className="btn-quiet min-h-9 px-3 text-sm" href={`/api/admin/backups/${encodeURIComponent(b.name)}/download`} download>
              <Download className="size-4" aria-hidden /> Download
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
