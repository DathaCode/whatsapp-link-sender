import type { Request } from 'express';
import type { AuditContext } from '../audit.js';
import { ANONYMOUS } from '../audit.js';
import type { SessionUser } from '../auth/sessions.js';

export interface AuthState {
  user: SessionUser;
  sessionId: string;
  csrf: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthState;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? null;
export const userAgent = (req: Request) => req.get('user-agent')?.slice(0, 300) ?? null;

/** Who is making this request, for the audit log. */
export function ctxOf(req: Request): AuditContext {
  const a = req.auth;
  return {
    actor: a ? { userId: a.user.id, username: a.user.username, role: a.user.role } : ANONYMOUS,
    ip: clientIp(req),
    userAgent: userAgent(req),
    sessionId: a?.sessionId ?? null,
  };
}

/** The signed-in user (routes behind a guard always have one). */
export function me(req: Request): SessionUser {
  if (!req.auth) throw new Error('route is missing an auth guard');
  return req.auth.user;
}
