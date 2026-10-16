import { AlertTriangle, Pencil, Plus, RefreshCw, Trash2, Users as UsersIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { GroupDiagnostics } from '../components/GroupDiagnostics';
import { GroupPicker } from '../components/GroupPicker';
import { plural } from '../format';
import { useLive } from '../store';
import type { Group, Preset, UserView } from '../types';

export function GroupsPresets() {
  const { sending, groupsVersion } = useLive();
  const [groups, setGroups] = useState<Group[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [users, setUsers] = useState<UserView[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Preset | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Preset | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, p, u] = await Promise.all([
        api<{ groups: Group[] }>('/api/admin/groups'),
        api<{ presets: Preset[] }>('/api/admin/presets'),
        api<{ users: UserView[] }>('/api/admin/users'),
      ]);
      setGroups(g.groups);
      setPresets(p.presets);
      setUsers(u.users);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, groupsVersion, sending?.connection?.id]);

  const onNumber = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api<{ groups: Group[] }>('/api/admin/groups/refresh', { body: {} });
      setGroups(r.groups);
      toast.success(`Found ${plural(r.groups.length, 'group')} on ${sending?.connection?.label ?? 'the active number'}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      const r = await api<{ presets: Preset[] }>(`/api/admin/presets/${deleting.id}`, { method: 'DELETE' });
      setPresets(r.presets);
      toast.success('Preset deleted.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card p-5" aria-labelledby="groups-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="groups-title" className="text-lg font-bold">
              Groups on the active number
            </h2>
            <p className="hint">
              {sending?.connection
                ? `${sending.connection.label}: ${plural(groups.filter((g) => !g.readOnly).length, 'group')} it can post to, ${groups.filter((g) => g.readOnly).length} it can’t, ${plural(new Set(groups.map((g) => g.communityId).filter(Boolean)).size, 'Community', 'Communities')}.`
                : 'No active number.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GroupDiagnostics disabled={!sending?.available} />
            <button type="button" className="btn-primary" onClick={refresh} disabled={refreshing || !sending?.available}>
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              {refreshing ? 'Fetching from WhatsApp…' : 'Refresh groups'}
            </button>
          </div>
        </div>
        {!sending?.available && <p className="mt-3 text-sm text-warn">Connect the active number to refresh its groups.</p>}
      </section>

      <section className="space-y-3" aria-labelledby="presets-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="presets-title" className="text-lg font-bold">
            Presets
          </h2>
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> New preset
          </button>
        </div>
        <p className="hint">A preset is a named list of groups. Users can only send to the presets you give them on the Users page.</p>
        {presets.length === 0 && <p className="card p-6 text-center text-muted">No presets yet.</p>}
        <ul className="space-y-3" role="list">
          {presets.map((p) => {
            const missing = p.groups.filter((g) => !onNumber.has(g.id));
            const who = users.filter((u) => p.userIds?.includes(u.id));
            return (
              <li key={p.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted">{plural(p.groups.length, 'group')}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                      <UsersIcon className="size-4" aria-hidden />
                      {who.length ? who.map((u) => u.displayName).join(', ') : 'No users yet (admins can always use it)'}
                    </p>
                    {missing.length > 0 && groups.length > 0 && (
                      <p className="mt-1 flex items-start gap-1.5 text-sm text-warn">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {plural(missing.length, 'group')} not on the active number: {missing.map((g) => g.name).slice(0, 3).join(', ')}
                        {missing.length > 3 ? '…' : ''}
                      </p>
                    )}
                  </div>
                  <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-surface-2" onClick={() => setEditing(p)} aria-label={`Edit preset ${p.name}`}>
                    <Pencil className="size-4" />
                  </button>
                  <button type="button" className="grid size-10 place-items-center rounded-lg text-bad hover:bg-bad-soft" onClick={() => setDeleting(p)} aria-label={`Delete preset ${p.name}`}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <PresetDialog
        value={editing}
        groups={groups}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
          toast.success('Preset saved.');
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title={`Delete “${deleting?.name}”?`}
        body={<>Users who had this preset can no longer send to its groups. The WhatsApp groups themselves are not touched. Past sends stay in history.</>}
        confirmLabel="Delete preset"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function PresetDialog({ value, groups, onClose, onSaved }: { value: Preset | 'new' | null; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const preset = value && value !== 'new' ? value : null;

  useEffect(() => {
    setName(preset?.name ?? '');
    setSelected(new Set(preset?.groups.map((g) => g.id) ?? []));
  }, [value, preset]);

  // Groups saved in the preset that the active number doesn't have (keep or drop them).
  const offNumber = (preset?.groups ?? []).filter((g) => !groups.some((x) => x.id === g.id));
  const pickable: Group[] = [...groups, ...offNumber.map((g) => ({ id: g.id, name: `${g.name} (not on active number)`, readOnly: false }))];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const names = new Map([...groups.map((g) => [g.id, g.name] as const), ...(preset?.groups ?? []).map((g) => [g.id, g.name] as const)]);
    const body = { name: name.trim(), groups: [...selected].map((id) => ({ id, name: names.get(id) ?? id })) };
    try {
      if (preset) await api(`/api/admin/presets/${preset.id}`, { method: 'PUT', body });
      else await api('/api/admin/presets', { body });
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!value} title={preset ? `Edit “${preset.name}”` : 'New preset'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="preset-name" className="label">
            Name
          </label>
          <input id="preset-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="e.g. Sinhala groups" autoFocus />
        </div>
        <div>
          <p className="label">
            Groups <span className="font-normal text-muted">({selected.size} selected)</span>
          </p>
          <GroupPicker groups={pickable} selected={selected} onChange={setSelected} maxHeight="max-h-64" />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save preset'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
