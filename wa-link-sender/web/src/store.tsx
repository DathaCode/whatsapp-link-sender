import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ConnectionView, Job, Me, QueueStatus, SendingStatus, Usage } from './types';

interface LiveState {
  live: boolean;
  sending: SendingStatus | null;
  queue: QueueStatus | null;
  usage: Usage | null;
  /** Jobs seen through live updates, keyed by id. */
  jobs: Record<number, Job>;
  /** Admin only. */
  connections: ConnectionView[] | null;
  /** Bumps whenever the group list of the active number changes. */
  groupsVersion: number;
}

interface LiveValue extends LiveState {
  me: Me;
  isAdmin: boolean;
  upsertJob: (j: Job) => void;
  setConnections: (c: ConnectionView[]) => void;
  setSending: (s: SendingStatus) => void;
}

const Ctx = createContext<LiveValue | null>(null);

export function LiveProvider({ me, children, onSignedOut }: { me: Me; children: ReactNode; onSignedOut: () => void }) {
  const isAdmin = me.role === 'ADMIN';
  const [state, setState] = useState<LiveState>({
    live: false,
    sending: null,
    queue: null,
    usage: null,
    jobs: {},
    connections: null,
    groupsVersion: 0,
  });
  const patch = useCallback((p: Partial<LiveState>) => setState((s) => ({ ...s, ...p })), []);
  const upsertJob = useCallback((j: Job) => setState((s) => ({ ...s, jobs: { ...s.jobs, [j.id]: { ...s.jobs[j.id], ...j } } })), []);

  useEffect(() => {
    const es = new EventSource('/api/events');
    const on = <T,>(name: string, fn: (d: T) => void) =>
      es.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data) as T));
    es.onopen = () => patch({ live: true });
    es.onerror = () => patch({ live: false });
    on<SendingStatus>('sending', (sending) => patch({ sending }));
    if (!isAdmin) on<SendingStatus>('sending_user', (sending) => patch({ sending }));
    on<QueueStatus>('queue', (queue) => patch({ queue }));
    on<Usage>('usage', (usage) => patch({ usage }));
    on<Job>('job', upsertJob);
    on<ConnectionView[]>('connections', (connections) => patch({ connections }));
    on<unknown>('groups', () => setState((s) => ({ ...s, groupsVersion: s.groupsVersion + 1 })));
    on<unknown>('signed_out', () => {
      es.close();
      onSignedOut();
    });
    return () => es.close();
  }, [isAdmin, patch, upsertJob, onSignedOut]);

  const value = useMemo<LiveValue>(
    () => ({
      ...state,
      me,
      isAdmin,
      upsertJob,
      setConnections: (connections) => patch({ connections }),
      setSending: (sending) => patch({ sending }),
    }),
    [state, me, isAdmin, upsertJob, patch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLive outside LiveProvider');
  return v;
}
