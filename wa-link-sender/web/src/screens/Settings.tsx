import { DatabaseBackup, Download, ImageIcon, Link2, Pencil, Plus, ShieldCheck, TextQuote, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { formatDateTime } from '../format';
import type { MessagingSettings, SafetySettings, Snippet } from '../types';

interface SettingsResponse {
  settings: SafetySettings;
  messaging: MessagingSettings;
  messagingDefaults: MessagingSettings;
  timeZone: string;
  auditRetentionDays: number;
  uploadRetentionDays: number;
}

export function Settings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  useEffect(() => {
    api<SettingsResponse>('/api/admin/settings').then(setData, (e) => toast.error(errorMessage(e)));
  }, []);
  if (!data) return <p className="card p-5 text-muted">Loading…</p>;
  return (
    <div className="space-y-4">
      <SafetyCard initial={data.settings} timeZone={data.timeZone} uploadRetentionDays={data.uploadRetentionDays} />
      <LinksCard initial={data.messaging} defaults={data.messagingDefaults} />
      <SnippetsCard />
      <BackupsCard />
    </div>
  );
}

function SafetyCard({ initial, timeZone, uploadRetentionDays }: { initial: SafetySettings; timeZone: string; uploadRetentionDays: number }) {
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const num = (k: keyof SafetySettings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value === '' ? 0 : Number(e.target.value) }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ settings: SafetySettings }>('/api/admin/settings', { method: 'PUT', body: form });
      setSaved(r.settings);
      setForm(r.settings);
      toast.success('Sending settings saved. The change is in the audit log.');
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
      toast.success('Back to the default values.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="safety-title">
      <h2 id="safety-title" className="flex items-center gap-2 text-lg font-bold">
        <ShieldCheck className="size-5 text-accent" aria-hidden /> Sending & safety
      </h2>
      <p className="hint mt-1">
        These rules make sending look like a person and lower the chance of WhatsApp blocking the number. The server enforces them for everyone. Times use {timeZone}.
      </p>
      <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
        <fieldset>
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
        <fieldset>
          <legend className="label">Pause for posts with an image (seconds)</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="imin" className="hint mb-1 block">
                Shortest
              </label>
              <input id="imin" type="number" min={5} max={3600} className="field" value={form.imageMinDelaySeconds} onChange={num('imageMinDelaySeconds')} required />
            </div>
            <div>
              <label htmlFor="imax" className="hint mb-1 block">
                Longest
              </label>
              <input id="imax" type="number" min={5} max={3600} className="field" value={form.imageMaxDelaySeconds} onChange={num('imageMaxDelaySeconds')} required />
            </div>
          </div>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="label flex items-center gap-2">
            <ImageIcon className="size-4 text-muted" aria-hidden /> How to send a post with an image
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['single', 'One message (recommended)', 'The image with the full text as its caption. Links show as plain links; captions are limited to 1,024 characters.'],
                ['two', 'Two messages', 'The image, then the text separately so WhatsApp shows the link preview card. Counts as 2 messages per group against the daily limit.'],
              ] as const
            ).map(([value, title, desc]) => (
              <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${form.imageSendMode === value ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                <input type="radio" name="imageSendMode" className="mt-1 size-4 accent-(--accent)" checked={form.imageSendMode === value} onChange={() => setForm((f) => ({ ...f, imageSendMode: value }))} />
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-muted">{desc}</span>
                </span>
              </label>
            ))}
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
            <input id="ws" type="time" className="field" value={form.windowStart} onChange={(e) => setForm((f) => ({ ...f, windowStart: e.target.value }))} required />
            <span className="text-muted">to</span>
            <label htmlFor="we" className="sr-only">
              Until
            </label>
            <input id="we" type="time" className="field" value={form.windowEnd} onChange={(e) => setForm((f) => ({ ...f, windowEnd: e.target.value }))} required />
          </div>
        </fieldset>
        <p className="hint sm:col-span-2">Attached images are deleted after {uploadRetentionDays} days (UPLOAD_RETENTION_DAYS); history then shows “image expired”.</p>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={reset}>
            Use defaults
          </button>
          <button type="submit" className="btn-primary" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

const toLines = (list: string[]) => list.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function LinksCard({ initial, defaults }: { initial: MessagingSettings; defaults: MessagingSettings }) {
  const [saved, setSaved] = useState(initial);
  const [domains, setDomains] = useState(toLines(initial.allowedDomains));
  const [repeating, setRepeating] = useState(toLines(initial.repeatingLinks));
  const [busy, setBusy] = useState(false);
  const dirty = toLines(saved.allowedDomains) !== toLines(fromLines(domains)) || toLines(saved.repeatingLinks) !== toLines(fromLines(repeating));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ messaging: MessagingSettings }>('/api/admin/settings/messaging', {
        method: 'PUT',
        body: { allowedDomains: fromLines(domains), repeatingLinks: fromLines(repeating) },
      });
      setSaved(r.messaging);
      setDomains(toLines(r.messaging.allowedDomains));
      setRepeating(toLines(r.messaging.repeatingLinks));
      toast.success('Link settings saved. The change is in the audit log.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="links-title">
      <h2 id="links-title" className="flex items-center gap-2 text-lg font-bold">
        <Link2 className="size-5 text-accent" aria-hidden /> Links
      </h2>
      <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="domains" className="label">
            Allowed sites
          </label>
          <textarea id="domains" className="field min-h-44 py-2.5 font-mono text-sm" value={domains} onChange={(e) => setDomains(e.target.value)} aria-describedby="domains-help" spellCheck={false} />
          <p id="domains-help" className="hint mt-1.5">
            One domain per line; subdomains are included (m.facebook.com counts as facebook.com). Users can’t send other links; admins must confirm.
          </p>
        </div>
        <div>
          <label htmlFor="repeating" className="label">
            Repeating links
          </label>
          <textarea id="repeating" className="field min-h-44 py-2.5 font-mono text-sm" value={repeating} onChange={(e) => setRepeating(e.target.value)} aria-describedby="repeating-help" spellCheck={false} />
          <p id="repeating-help" className="hint mt-1.5">
            One link per line. Links that appear in every post (like your profile links) never count as “already sent”. Links inside snippets are ignored too.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setDomains(toLines(defaults.allowedDomains));
              setRepeating(toLines(defaults.repeatingLinks));
            }}
          >
            Fill in defaults
          </button>
          <button type="submit" className="btn-primary" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

function SnippetsCard() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [editing, setEditing] = useState<Partial<Snippet> | null>(null);
  const [deleting, setDeleting] = useState<Snippet | null>(null);

  useEffect(() => {
    api<{ snippets: Snippet[] }>('/api/admin/snippets').then((r) => setSnippets(r.snippets), (e) => toast.error(errorMessage(e)));
  }, []);

  const remove = async () => {
    if (!deleting) return;
    try {
      const r = await api<{ snippets: Snippet[] }>(`/api/admin/snippets/${deleting.id}`, { method: 'DELETE' });
      setSnippets(r.snippets);
      toast.success('Snippet deleted.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="snip-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="snip-title" className="flex items-center gap-2 text-lg font-bold">
          <TextQuote className="size-5 text-accent" aria-hidden /> Snippets
        </h2>
        <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setEditing({ name: '', body: '' })}>
          <Plus className="size-4" aria-hidden /> New
        </button>
      </div>
      <p className="hint mt-1">Reusable text blocks, like the “FOLLOW US ON” footer. Everyone can insert them on the Send page with one click.</p>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line" role="list">
        {snippets.length === 0 && <li className="p-3 text-muted">No snippets yet.</li>}
        {snippets.map((t) => (
          <li key={t.id} className="flex items-start gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t.name}</p>
              <p className="font-message line-clamp-3 text-sm break-words whitespace-pre-wrap text-muted">{t.body}</p>
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
      <SnippetDialog
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={(list) => {
          setSnippets(list);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete this snippet?"
        body={<>“{deleting?.name}” will be removed. Past sends are not affected.</>}
        confirmLabel="Delete"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

function SnippetDialog({ value, onClose, onSaved }: { value: Partial<Snippet> | null; onClose: () => void; onSaved: (t: Snippet[]) => void }) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(value?.name ?? '');
    setBody(value?.body ?? '');
  }, [value]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { name: name.trim(), body };
      const r = value?.id
        ? await api<{ snippets: Snippet[] }>(`/api/admin/snippets/${value.id}`, { method: 'PUT', body: payload })
        : await api<{ snippets: Snippet[] }>('/api/admin/snippets', { body: payload });
      onSaved(r.snippets);
      toast.success('Snippet saved.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!value} title={value?.id ? 'Edit snippet' : 'New snippet'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="snip-name" className="label">
            Name
          </label>
          <input id="snip-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus placeholder="e.g. Follow us footer" />
        </div>
        <div>
          <label htmlFor="snip-body" className="label">
            Text
          </label>
          <textarea id="snip-body" className="field font-message min-h-48 py-2.5" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} required spellCheck={false} />
          <p className="hint mt-1.5">Kept exactly as typed: emoji, styled letters and blank lines included.</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || !body.trim()}>
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
