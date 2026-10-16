import { CONNECTION_LABEL, CONNECTION_TONE, toneClasses, type Tone } from '../format';
import type { ConnectionStatus } from '../types';

export function Badge({ tone, children, dot = false, large = false }: { tone: Tone; children: React.ReactNode; dot?: boolean; large?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${toneClasses[tone]} ${large ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs'}`}>
      {dot && <span className="inline-flex size-2 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function ConnectionBadge({ status, large = false }: { status: ConnectionStatus; large?: boolean }) {
  const pulsing = status === 'connecting' || status === 'disconnected' || status === 'linking';
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full font-semibold whitespace-nowrap ${toneClasses[CONNECTION_TONE[status]]} ${
        large ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs'
      }`}
    >
      <span className="relative flex size-2">
        {pulsing && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
        <span className="relative inline-flex size-2 rounded-full bg-current" />
      </span>
      {CONNECTION_LABEL[status]}
    </span>
  );
}
