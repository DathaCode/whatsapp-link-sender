import { Plus, QrCode, RefreshCw, Smartphone, Star, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Badge, ConnectionBadge } from '../components/StatusBadge';
import { formatDate, formatDateTime, timeAgo } from '../format';
import { useLive } from '../store';
import type { ConnectionView } from '../types';

type Confirm = { kind: 'activate' | 'remove' | 'relink'; c: ConnectionView } | null;

export function Connections() {
  const { connections: liveConnections, setConnections } = useLive();
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  useEffect(() => {
    api<{ connections: ConnectionView[] }>('/api/admin/connections').then((r) => setConnections(r.connections), (e) => toast.error(errorMessage(e)));
  }, [setConnections]);

  const list = liveConnections ?? [];
  const current = list.filter((c) => c.status !== 'retired').sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.id - a.id);
  const retired = list.filter((c) => c.status === 'retired');
  const linking = list.some((c) => c.status === 'linking');

  const act = async (c: ConnectionView, path: string, method = 'POST', success?: string) => {
    setBusyId(c.id);
    try {
      const r = await api<{ connections: ConnectionView[] }>(`/api/admin/connections/${c.id}${path}`, { method, body: method === 'DELETE' ? undefined : {} });
      setConnections(r.connections);
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const runConfirm = () => {
    if (!confirm) return;
    const { kind, c } = confirm;
    setConfirm(null);
    if (kind === 'activate') void act(c, '/activate', 'POST', `${c.label} is now the sending number. It is connecting…`);
    if (kind === 'relink') void act(c, '/relink', 'POST', 'Scan the new QR code with the phone.');
    if (kind === 'remove') void act(c, '', 'DELETE', `${c.label} was removed. Its history is kept.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-muted">
          The <strong className="text-ink">active</strong> number sends all messages. Only one is active at a time, and the app never switches numbers by itself.
        </p>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)} disabled={linking} title={linking ? 'Finish the number being linked first' : undefined}>
          <Plus className="size-4" aria-hidden /> Add number
        </button>
      </div>

      {current.length === 0 && (
        <div className="card p-8 text-center">
          <Smartphone className="mx-auto mb-2 size-8 text-muted" aria-hidden />
          <p className="font-semibold">No WhatsApp numbers yet</p>
          <p className="hint mt-1">Press “Add number” and scan the QR code with the phone that will send the links.</p>
        </div>
      )}

      {current.map((c) => (
        <ConnectionCard key={c.id} c={c} busy={busyId === c.id} onConfirm={(kind) => setConfirm({ kind, c })} onCancelLink={() => void act(c, '/cancel-link', 'POST')} />
      ))}

      {retired.length > 0 && (
        <section>
          <button type="button" className="text-sm font-semibold text-accent" aria-expanded={showRetired} onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? 'Hide' : 'Show'} removed numbers ({retired.length})
          </button>
          {showRetired && (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
              {retired.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-muted">
                  <span className="font-semibold text-ink">{c.label}</span>
                  <span>{c.phone ? `+${c.phone}` : 'never linked'}</span>
                  <span className="ml-auto">
                    removed {c.retiredAt ? formatDate(c.retiredAt) : ''} · {c.sentTotal} sent in total
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          toast.success('Scan the QR code below with the phone.');
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'activate' ? `Make “${confirm.c.label}” the sending number?` : confirm?.kind === 'relink' ? `Re-link “${confirm?.c.label}”?` : `Remove “${confirm?.c.label}”?`}
        body={
          confirm?.kind === 'activate' ? (
            <>
              All sends will use this number from now on. The current active number goes on standby (its login is kept). After it connects, refresh groups and check your presets.
            </>
          ) : confirm?.kind === 'relink' ? (
            <>Its saved login is deleted and a new QR code is shown. {confirm?.c.isActive ? 'Sending pauses until the phone scans it.' : ''}</>
          ) : (
            <>
              This signs the number out of WhatsApp (if it is running) and deletes its saved login. Its history stays in the logs. {confirm?.c.isActive && <strong className="text-bad">Sending will pause until you make another number active.</strong>}
            </>
          )
        }
        confirmLabel={confirm?.kind === 'activate' ? 'Make active' : confirm?.kind === 'relink' ? 'Show new QR' : 'Remove number'}
        danger={confirm?.kind === 'remove'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function ConnectionCard({
  c,
  busy,
  onConfirm,
  onCancelLink,
}: {
  c: ConnectionView;
  busy: boolean;
  onConfirm: (kind: 'activate' | 'remove' | 'relink') => void;
  onCancelLink: () => void;
}) {
  const problem = c.status === 'logged_out' || c.status === 'possibly_banned';
  return (
    <section className={`card p-5 ${c.isActive ? 'ring-2 ring-accent/40' : ''}`} aria-labelledby={`conn-${c.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={`conn-${c.id}`} className="flex flex-wrap items-center gap-2 text-lg font-bold">
            {c.label}
            {c.isActive && (
              <Badge tone="accent">
                <Star className="size-3" aria-hidden /> Active
              </Badge>
            )}
          </h2>
          <p className="text-muted">
            {c.phone ? `+${c.phone}` : 'Not linked yet'}
            {c.pushName ? ` · ${c.pushName}` : ''}
          </p>
        </div>
        <ConnectionBadge status={c.status} large />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">Added</dt>
          <dd className="font-semibold">
            {formatDate(c.addedAt)}
            {c.addedByUsername ? ` by ${c.addedByUsername}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Sent today</dt>
          <dd className="font-semibold tabular-nums">{c.sentToday}</dd>
        </div>
        <div>
          <dt className="text-muted">Sent in total</dt>
          <dd className="font-semibold tabular-nums">{c.sentTotal}</dd>
        </div>
        <div>
          <dt className="text-muted">Linked</dt>
          <dd className="font-semibold">{c.linkedAt ? timeAgo(c.linkedAt) : '–'}</dd>
        </div>
      </dl>

      {c.lastError && c.status !== 'connected' && (
        <p className={`mt-4 rounded-xl px-3 py-2 text-sm ${problem ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn'}`}>
          <strong>Last problem{c.lastErrorAt ? ` (${formatDateTime(c.lastErrorAt)})` : ''}:</strong> {c.lastError}
        </p>
      )}

      {c.status === 'linking' && (
        <div className="mt-5 grid gap-6 rounded-2xl bg-surface-2 p-4 md:grid-cols-[auto_1fr] md:items-center">
          <div className="mx-auto rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line">
            {c.qr ? (
              <img src={c.qr} alt={`QR code to link ${c.label}`} className="size-60 sm:size-64" />
            ) : (
              <div className="grid size-60 place-items-center text-sm text-neutral-500 sm:size-64">Preparing QR code…</div>
            )}
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              <QrCode className="size-5 text-accent" aria-hidden /> Link the phone
            </h3>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Open WhatsApp on the phone with the number you want to add.</li>
              <li>
                Android: <strong>⋮</strong> → <strong>Linked devices</strong>. iPhone: <strong>Settings</strong> → <strong>Linked devices</strong>.
              </li>
              <li>
                Tap <strong>Link a device</strong> and scan this code.
              </li>
              <li>Wait here. This updates by itself. The code expires after 5 minutes.</li>
            </ol>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {c.status === 'linking' && (
          <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={onCancelLink} disabled={busy}>
            <X className="size-4" aria-hidden /> Cancel
          </button>
        )}
        {!c.isActive && c.status === 'standby' && (
          <button type="button" className="btn-primary min-h-9 px-3 text-sm" onClick={() => onConfirm('activate')} disabled={busy}>
            <Star className="size-4" aria-hidden /> Make active
          </button>
        )}
        {c.status !== 'linking' && (
          <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => onConfirm('relink')} disabled={busy}>
            <RefreshCw className="size-4" aria-hidden /> {c.status === 'link_expired' && !c.linkedAt ? 'Show QR again' : 'Re-link'}
          </button>
        )}
        <button type="button" className="btn-danger min-h-9 px-3 text-sm sm:ml-auto" onClick={() => onConfirm('remove')} disabled={busy}>
          <Trash2 className="size-4" aria-hidden /> Remove
        </button>
      </div>
    </section>
  );
}

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { setConnections } = useLive();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setLabel('');
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/admin/connections', { body: { label: label.trim() } });
      const r = await api<{ connections: ConnectionView[] }>('/api/admin/connections');
      setConnections(r.connections);
      onAdded();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Add a WhatsApp number" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="conn-label" className="label">
            Name for this number
          </label>
          <input id="conn-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="e.g. Office phone 2" required autoFocus />
          <p className="hint mt-1.5">Use a number that is already in your groups, or add it to the groups after linking.</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !label.trim()}>
            {busy ? 'Starting…' : 'Show QR code'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
