import { Link2Off, RefreshCw, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { ConfirmDialog } from '../components/Dialog';
import { StatusBadge } from '../components/StatusBadge';
import { plural } from '../format';
import { useApp } from '../store';
import type { Group } from '../types';

function useSecondsUntil(ts: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ts) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ts]);
  return ts ? Math.max(0, Math.ceil((ts - now) / 1000)) : null;
}

export function Connection() {
  const { state, setGroups } = useApp();
  const wa = state.whatsapp;
  const [refreshing, setRefreshing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const retryIn = useSecondsUntil(wa.state === 'reconnecting' ? wa.nextRetryAt : null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api<{ groups: Group[] }>('/api/groups/refresh', { body: {} });
      setGroups(r.groups);
      toast.success(`Found ${plural(r.groups.length, 'group')}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const unlink = async () => {
    setConfirmUnlink(false);
    try {
      await api('/api/whatsapp/unlink', { body: {} });
      toast.success('WhatsApp unlinked. A new QR code will appear in a few seconds.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-6" aria-labelledby="conn-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="conn-title" className="text-xl font-bold">
            WhatsApp connection
          </h2>
          <StatusBadge state={wa.state} large />
        </div>

        {wa.state === 'ready' && (
          <div className="mt-5">
            <p className="text-lg">
              Linked as <strong>{wa.account?.name || 'your number'}</strong>
              {wa.account?.phone && <span className="text-muted"> (+{wa.account.phone})</span>}
            </p>
            <p className="hint mt-1">
              {plural(state.groups.length, 'group')} available. Keep the phone switched on and online now and then so the link
              stays active.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn-quiet" onClick={refresh} disabled={refreshing}>
                <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
                {refreshing ? 'Loading groups…' : 'Refresh groups'}
              </button>
              <button type="button" className="btn-danger" onClick={() => setConfirmUnlink(true)}>
                <Link2Off className="size-4" aria-hidden /> Unlink WhatsApp
              </button>
            </div>
          </div>
        )}

        {wa.state === 'qr' && wa.qr && (
          <div className="mt-5 grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
            <div className="mx-auto rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line">
              <img src={wa.qr} alt="QR code to link WhatsApp" className="size-64 sm:size-72" />
            </div>
            <div>
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <Smartphone className="size-5 text-accent" aria-hidden /> Link the sending phone
              </h3>
              <ol className="list-decimal space-y-2 pl-5">
                <li>Open WhatsApp on the phone whose number will send the links.</li>
                <li>
                  Android: tap <strong>⋮</strong> → <strong>Linked devices</strong>. iPhone: tap <strong>Settings</strong> →{' '}
                  <strong>Linked devices</strong>.
                </li>
                <li>
                  Tap <strong>Link a device</strong> and point the camera at this code.
                </li>
                <li>Wait here. This page updates by itself when the link is done.</li>
              </ol>
              <p className="hint mt-4">The code changes every few seconds. That is normal, so scan the newest one.</p>
            </div>
          </div>
        )}

        {(wa.state === 'starting' || wa.state === 'authenticating') && (
          <p className="mt-5 text-muted">
            {wa.state === 'starting'
              ? 'Starting WhatsApp. This takes up to a minute after the app starts.'
              : 'Phone linked. Loading your chats. This can take a minute for numbers with many chats.'}
          </p>
        )}

        {wa.state === 'reconnecting' && (
          <div className="mt-5 rounded-xl bg-warn-soft p-4 text-warn">
            <p className="font-semibold">Reconnecting{retryIn ? ` in ${retryIn} s` : '…'}</p>
            {wa.lastError && <p className="mt-1 text-sm">{wa.lastError}</p>}
            <p className="mt-1 text-sm">
              You don’t need to do anything. Saved sends wait and continue when it is back. If this lasts more than 10
              minutes, restart the app: <code>docker compose restart</code>.
            </p>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmUnlink}
        title="Unlink WhatsApp?"
        body={
          <>
            This signs the app out of WhatsApp. Sending stops until someone scans a new QR code with the phone. Your history,
            templates and group lists are kept.
          </>
        }
        confirmLabel="Unlink"
        danger
        onConfirm={unlink}
        onCancel={() => setConfirmUnlink(false)}
      />
    </div>
  );
}
