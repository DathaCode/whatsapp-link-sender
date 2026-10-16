import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Bootstrap, Group, Job, Preset, QueueStatus, SafetySettings, Template, Usage, WaStatus } from './types';

interface AppState extends Bootstrap {
  /** Jobs we have seen live updates for, keyed by id (includes items). */
  jobs: Record<number, Job>;
  live: boolean;
}

interface AppContextValue {
  state: AppState;
  setGroups: (g: Group[]) => void;
  setPresets: (p: Preset[]) => void;
  setTemplates: (t: Template[]) => void;
  setSettings: (s: SafetySettings) => void;
  upsertJob: (j: Job) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ initial, children }: { initial: Bootstrap; children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => ({
    ...initial,
    jobs: Object.fromEntries(initial.activeJobs.map((j) => [j.id, j])),
    live: false,
  }));

  const patch = useCallback((p: Partial<AppState>) => setState((s) => ({ ...s, ...p })), []);
  const upsertJob = useCallback((j: Job) => setState((s) => ({ ...s, jobs: { ...s.jobs, [j.id]: j } })), []);

  const reload = useCallback(async () => {
    const b = await api<Bootstrap>('/api/bootstrap');
    setState((s) => ({
      ...s,
      ...b,
      jobs: { ...s.jobs, ...Object.fromEntries(b.activeJobs.map((j) => [j.id, j])) },
    }));
  }, []);

  // Live updates from the server (Server-Sent Events). The browser reconnects by itself.
  useEffect(() => {
    const es = new EventSource('/api/events');
    const on = <T,>(name: string, fn: (d: T) => void) =>
      es.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data) as T));
    es.onopen = () => patch({ live: true });
    es.onerror = () => patch({ live: false });
    on<WaStatus>('whatsapp', (whatsapp) => patch({ whatsapp }));
    on<QueueStatus>('queue', (queue) => patch({ queue }));
    on<Usage>('usage', (usage) => patch({ usage }));
    on<Group[]>('groups', (groups) => patch({ groups }));
    on<Job>('job', upsertJob);
    return () => es.close();
  }, [patch, upsertJob]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      setGroups: (groups) => patch({ groups }),
      setPresets: (presets) => patch({ presets }),
      setTemplates: (templates) => patch({ templates }),
      setSettings: (settings) => patch({ settings }),
      upsertJob,
      reload,
    }),
    [state, patch, upsertJob, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
