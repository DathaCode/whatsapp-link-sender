export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | undefined,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}

let csrfToken = '';
export const setCsrf = (t: string) => {
  csrfToken = t;
};

type Listener = (code: string | undefined) => void;
const unauthorizedListeners = new Set<Listener>();
/** Called when the server says the session is gone (signed out, expired, disabled). */
export const onUnauthorized = (fn: Listener) => {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
};

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the app. Check that it is running (docker compose ps).', 'network', {});
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof data.code === 'string' ? data.code : undefined;
  if (res.status === 401 && !path.startsWith('/api/auth/login')) unauthorizedListeners.forEach((fn) => fn(code));
  if (!res.ok) {
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : `Request failed (${res.status}).`, code, data);
  }
  return data as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Uploads a file as the raw request body (the server re-encodes and checks it). */
export async function uploadFile<T = unknown>(path: string, file: File): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrfToken, 'X-File-Name': encodeURIComponent(file.name || 'image') },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the app. Check your connection and try again.', 'network', {});
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof data.code === 'string' ? data.code : undefined;
  if (res.status === 401) unauthorizedListeners.forEach((fn) => fn(code));
  if (!res.ok) throw new ApiError(res.status, typeof data.error === 'string' ? data.error : `Upload failed (${res.status}).`, code, data);
  return data as T;
}
