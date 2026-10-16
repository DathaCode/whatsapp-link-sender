import { AlertTriangle, Loader2 } from 'lucide-react';
import { pauseText } from '../format';
import { useLive } from '../store';

/** Shown when sending is paused. Admins get the reason and where to fix it; users a friendly note. */
export function PauseBanner({ onOpenConnections }: { onOpenConnections?: () => void }) {
  const { sending, isAdmin } = useLive();
  if (!sending || sending.available) return null;
  const transient = sending.reason === 'connecting' || sending.reason === 'disconnected';
  const tone = transient ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad';
  const Icon = transient ? Loader2 : AlertTriangle;
  return (
    <div role="status" className={`mx-auto mt-3 flex max-w-5xl items-start gap-3 rounded-xl px-4 py-3 text-sm ${tone}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${transient ? 'animate-spin' : ''}`} aria-hidden />
      <p className="flex-1">
        {isAdmin && <strong className="font-semibold">{transient ? 'Reconnecting. ' : 'Sending is paused. '}</strong>}
        {pauseText(sending.reason, isAdmin)}
      </p>
      {isAdmin && onOpenConnections && !transient && (
        <button type="button" className="shrink-0 font-semibold underline" onClick={onOpenConnections}>
          Open Connections
        </button>
      )}
    </div>
  );
}
