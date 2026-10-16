import { useId, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import type { Me } from '../types';

const MIN = 10;

/** Current + new + confirm. Used by the forced "set a new password" screen and the change-password dialog. */
export function PasswordForm({
  onDone,
  submitLabel = 'Save new password',
  onCancel,
}: {
  onDone: (me: Me) => void;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const id = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN;
  const mismatch = confirm.length > 0 && confirm !== next;
  const sameAsOld = next.length > 0 && next === current;
  const canSubmit = current && next.length >= MIN && next === confirm && !sameAsOld && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ user: Me }>('/api/auth/change-password', { body: { currentPassword: current, newPassword: next } });
      onDone(r.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor={`${id}-cur`} className="label">
          Current password
        </label>
        <input id={`${id}-cur`} type="password" className="field" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
      </div>
      <div>
        <label htmlFor={`${id}-new`} className="label">
          New password
        </label>
        <input
          id={`${id}-new`}
          type="password"
          className="field"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          aria-describedby={`${id}-new-help`}
          aria-invalid={tooShort || sameAsOld}
          required
        />
        <p id={`${id}-new-help`} className={`mt-1.5 text-sm ${tooShort || sameAsOld ? 'text-bad' : 'text-muted'}`}>
          {sameAsOld ? 'Choose something different from your current password.' : `At least ${MIN} characters. A short sentence is easy to remember.`}
        </p>
      </div>
      <div>
        <label htmlFor={`${id}-conf`} className="label">
          Type the new password again
        </label>
        <input
          id={`${id}-conf`}
          type="password"
          className="field"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? `${id}-mismatch` : undefined}
          required
        />
        {mismatch && (
          <p id={`${id}-mismatch`} className="mt-1.5 text-sm text-bad">
            The two passwords don’t match.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <button type="button" className="btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={!canSubmit}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
