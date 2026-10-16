import type { WaState } from '../types';

const LABEL: Record<WaState, string> = {
  ready: 'Connected',
  qr: 'Not linked',
  authenticating: 'Linking…',
  starting: 'Starting…',
  reconnecting: 'Reconnecting…',
  stopped: 'Stopped',
};

export function StatusBadge({ state, large = false }: { state: WaState; large?: boolean }) {
  const tone =
    state === 'ready'
      ? 'bg-ok-soft text-ok'
      : state === 'qr'
        ? 'bg-warn-soft text-warn'
        : state === 'stopped'
          ? 'bg-bad-soft text-bad'
          : 'bg-surface-2 text-muted';
  const pulsing = state === 'starting' || state === 'reconnecting' || state === 'authenticating';
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full font-semibold ${tone} ${
        large ? 'px-4 py-1.5 text-base' : 'px-3 py-1 text-sm'
      }`}
    >
      <span className="relative flex size-2.5">
        {pulsing && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
        <span className="relative inline-flex size-2.5 rounded-full bg-current" />
      </span>
      <span>
        <span className="sr-only">WhatsApp: </span>
        {LABEL[state]}
      </span>
    </span>
  );
}
