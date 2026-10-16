import { KeyRound } from 'lucide-react';
import { AuthFrame } from '../components/AuthFrame';
import { PasswordForm } from '../components/PasswordForm';
import type { Me } from '../types';

/** Shown right after sign-in when an admin created or reset the account. */
export function SetPassword({ me, onDone, onSignOut }: { me: Me; onDone: (me: Me) => void; onSignOut: () => void }) {
  return (
    <AuthFrame>
      <section className="card p-6 sm:p-8" aria-labelledby="setpw-title">
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <KeyRound className="size-6" aria-hidden />
        </div>
        <h1 id="setpw-title" className="text-2xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <p className="mt-1 mb-6 text-muted">
          Hi {me.displayName}. Before you continue, replace the temporary password with one only you know.
        </p>
        <PasswordForm onDone={onDone} submitLabel="Save and continue" />
        <button type="button" className="mt-4 w-full text-sm font-semibold text-muted hover:text-ink" onClick={onSignOut}>
          Sign out instead
        </button>
      </section>
    </AuthFrame>
  );
}
