import type { ReactNode } from 'react';
import { Brand } from './Logo';

/** WhatsApp Web-style landing: a green band across the top with the card overlapping it. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="h-52 bg-topbar" aria-hidden />
      <main className="-mt-40 px-4 pb-12">
        <div className="mx-auto mb-6 w-full max-w-md">
          <Brand onDark />
        </div>
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
