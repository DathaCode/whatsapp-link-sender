import { Copy, KeyRound, LogOut, Pencil, Plus, UserCheck, UserX } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Badge } from '../components/StatusBadge';
import { plural, timeAgo } from '../format';
import { useLive } from '../store';
import type { Preset, Role, UserView } from '../types';
import { copyText } from './History';

type Confirm = { kind: 'disable' | 'enable' | 'reset' | 'signout'; user: UserView } | null;

export function Users() {
  const { me } = useLive();
  const [users, setUsers] = useState<UserView[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [editing, setEditing] = useState<UserView | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [secret, setSecret] = useState<{ username: string; password: string; reason: 'created' | 'reset' } | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([api<{ users: UserView[] }>('/api/admin/users'), api<{ presets: Preset[] }>('/api/admin/presets')]);
      setUsers(u.users);
      setPresets(p.presets);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const replace = (u: UserView) => setUsers((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null);

  const runConfirm = async () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    setConfirm(null);
    try {
      if (kind === 'reset') {
        const r = await api<{ user: UserView; temporaryPassword: string }>(`/api/admin/users/${user.id}/reset-password`, { body: {} });
        replace(r.user);
        setSecret({ username: user.username, password: r.temporaryPassword, reason: 'reset' });
      } else if (kind === 'signout') {
        const r = await api<{ user: UserView; sessionsEnded: number }>(`/api/admin/users/${user.id}/sign-out`, { body: {} });
        replace(r.user);
        toast.success(`${user.username} was signed out (${plural(r.sessionsEnded, 'session')}).`);
      } else {
        const r = await api<{ user: UserView }>(`/api/admin/users/${user.id}/${kind}`, { body: {} });
        replace(r.user);
        toast.success(kind === 'disable' ? `${user.username} can no longer sign in.` : `${user.username} can sign in again.`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!users) return <p className="py-10 text-center text-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted">{plural(users.filter((u) => !u.disabled).length, 'active user')}</p>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden /> New user
        </button>
      </div>

      <ul className="space-y-3" role="list">
        {users.map((u) => (
          <li key={u.id} className={`card p-4 ${u.disabled ? 'opacity-70' : ''}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent" aria-hidden>
                {u.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {u.displayName} <span className="font-normal text-muted">@{u.username}</span>
                  {u.id === me.id && <Badge tone="accent">You</Badge>}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={u.role === 'ADMIN' ? 'accent' : 'neutral'}>{u.role === 'ADMIN' ? 'Admin' : 'User'}</Badge>
                  {u.disabled && <Badge tone="bad">Disabled</Badge>}
                  {u.mustChangePassword && !u.disabled && <Badge tone="warn">Must set new password</Badge>}
                  <span className="text-muted">
                    {u.lastLoginAt ? `Last sign-in ${timeAgo(u.lastLoginAt)}` : 'Never signed in'} · {plural(u.activeSessions, 'active session')}
                  </span>
                </div>
                {u.role === 'USER' && (
                  <p className="mt-1 text-sm text-muted">
                    Can send to:{' '}
                    {u.presetIds.length
                      ? presets
                          .filter((p) => u.presetIds.includes(p.id))
                          .map((p) => p.name)
                          .join(', ')
                      : 'nothing yet. Assign a preset.'}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
              <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setEditing(u)}>
                <Pencil className="size-4" aria-hidden /> Edit
              </button>
              <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setConfirm({ kind: 'reset', user: u })}>
                <KeyRound className="size-4" aria-hidden /> Reset password
              </button>
              {u.activeSessions > 0 && (
                <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setConfirm({ kind: 'signout', user: u })}>
                  <LogOut className="size-4" aria-hidden /> Sign out everywhere
                </button>
              )}
              {u.disabled ? (
                <button type="button" className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setConfirm({ kind: 'enable', user: u })}>
                  <UserCheck className="size-4" aria-hidden /> Enable
                </button>
              ) : (
                <button type="button" className="btn-danger min-h-9 px-3 text-sm" onClick={() => setConfirm({ kind: 'disable', user: u })}>
                  <UserX className="size-4" aria-hidden /> Disable
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <UserDialog
        value={editing}
        presets={presets}
        onClose={() => setEditing(null)}
        onSaved={(u, temporaryPassword) => {
          setEditing(null);
          setUsers((list) => (list?.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? u : x)) : [...(list ?? []), u]));
          if (temporaryPassword) setSecret({ username: u.username, password: temporaryPassword, reason: 'created' });
          else toast.success('Saved.');
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === 'disable'
            ? `Disable ${confirm.user.username}?`
            : confirm?.kind === 'enable'
              ? `Enable ${confirm.user.username}?`
              : confirm?.kind === 'reset'
                ? `Reset ${confirm?.user.username}’s password?`
                : `Sign ${confirm?.user.username} out everywhere?`
        }
        body={
          confirm?.kind === 'disable'
            ? 'They are signed out at once and cannot sign in. Their send history is kept. You can enable them again later.'
            : confirm?.kind === 'enable'
              ? 'They will be able to sign in again with their current password.'
              : confirm?.kind === 'reset'
                ? 'A temporary password is created and shown to you once. They are signed out and must choose a new password at next sign-in.'
                : 'All their open sessions end now. They can sign in again with their password.'
        }
        confirmLabel={confirm?.kind === 'disable' ? 'Disable' : confirm?.kind === 'enable' ? 'Enable' : confirm?.kind === 'reset' ? 'Reset password' : 'Sign out'}
        danger={confirm?.kind === 'disable' || confirm?.kind === 'reset'}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      />

      <Dialog open={!!secret} title={secret?.reason === 'created' ? 'User created' : 'Password reset'} onClose={() => setSecret(null)}>
        <p className="text-muted">
          Give this temporary password to <strong className="text-ink">{secret?.username}</strong> in person or by private message. It is shown only
          once. They will be asked to choose their own password when they sign in.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 p-3">
          <code className="flex-1 text-lg font-bold tracking-wide break-all">{secret?.password}</code>
          <button
            type="button"
            className="btn-quiet min-h-9 px-3 text-sm"
            onClick={async () => {
              await copyText(secret?.password ?? '');
              toast.success('Copied.');
            }}
          >
            <Copy className="size-4" aria-hidden /> Copy
          </button>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-primary" onClick={() => setSecret(null)}>
            Done
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function UserDialog({
  value,
  presets,
  onClose,
  onSaved,
}: {
  value: UserView | 'new' | null;
  presets: Preset[];
  onClose: () => void;
  onSaved: (u: UserView, temporaryPassword?: string | null) => void;
}) {
  const isNew = value === 'new';
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('USER');
  const [presetIds, setPresetIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return;
    if (value === 'new') {
      setUsername('');
      setDisplayName('');
      setRole('USER');
      setPresetIds(new Set());
    } else {
      setUsername(value.username);
      setDisplayName(value.displayName);
      setRole(value.role);
      setPresetIds(new Set(value.presetIds));
    }
  }, [value]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isNew) {
        const r = await api<{ user: UserView; temporaryPassword: string | null }>('/api/admin/users', {
          body: { username: username.trim(), displayName: displayName.trim(), role, presetIds: [...presetIds] },
        });
        onSaved(r.user, r.temporaryPassword);
      } else if (value) {
        let r = await api<{ user: UserView }>(`/api/admin/users/${value.id}`, { method: 'PUT', body: { displayName: displayName.trim(), role } });
        const before = [...value.presetIds].sort().join(',');
        const after = [...presetIds].sort().join(',');
        if (before !== after) r = await api<{ user: UserView }>(`/api/admin/users/${value.id}/presets`, { method: 'PUT', body: { presetIds: [...presetIds] } });
        onSaved(r.user);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!value} title={isNew ? 'New user' : `Edit ${username}`} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="u-name" className="label">
              Username
            </label>
            <input
              id="u-name"
              className="field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={!isNew}
              required
              pattern="[A-Za-z0-9._\-]{3,32}"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={isNew}
              aria-describedby="u-name-help"
            />
            <p id="u-name-help" className="hint mt-1">
              {isNew ? '3–32 letters, digits, dots or dashes. Used to sign in.' : 'Usernames can’t be changed.'}
            </p>
          </div>
          <div>
            <label htmlFor="u-display" className="label">
              Display name
            </label>
            <input id="u-display" className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} placeholder="e.g. Nimali" />
          </div>
        </div>
        <fieldset>
          <legend className="label">Role</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['USER', 'ADMIN'] as const).map((r) => (
              <label key={r} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${role === r ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                <input type="radio" name="role" className="mt-1 size-4 accent-(--accent)" checked={role === r} onChange={() => setRole(r)} />
                <span>
                  <span className="block font-semibold">{r === 'USER' ? 'User' : 'Admin'}</span>
                  <span className="block text-sm text-muted">{r === 'USER' ? 'Send to their presets and see their own history.' : 'Everything, including users, numbers and logs.'}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {role === 'USER' && (
          <fieldset>
            <legend className="label">Presets this user may send to</legend>
            {presets.length === 0 ? (
              <p className="hint">No presets yet. Create them on the Groups & Presets page.</p>
            ) : (
              <div className="max-h-56 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {presets.map((p) => (
                  <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      className="size-5 accent-(--accent)"
                      checked={presetIds.has(p.id)}
                      onChange={() => {
                        const n = new Set(presetIds);
                        if (n.has(p.id)) n.delete(p.id);
                        else n.add(p.id);
                        setPresetIds(n);
                      }}
                    />
                    <span className="flex-1">{p.name}</span>
                    <span className="text-sm text-muted">{plural(p.groups.length, 'group')}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
        {isNew && <p className="hint">A temporary password is created and shown once after saving.</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || (isNew && username.trim().length < 3)}>
            {busy ? 'Saving…' : isNew ? 'Create user' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
