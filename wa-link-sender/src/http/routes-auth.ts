import { z } from 'zod';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { AppError } from '../errors.js';
import { clientIp, ctxOf, me, parseCookies, userAgent } from './context.js';
import { route, sessionCookieOptions, type Deps, type RouteDef } from './app.js';

const IP_WINDOW_MS = 15 * 60_000;
const IP_MAX_FAILURES = 30;

/** Per-IP limit on failed sign-ins (the per-username lockout lives in UserService). */
class IpLimiter {
  private hits = new Map<string, { n: number; resetAt: number }>();
  blocked(ip: string): boolean {
    const h = this.hits.get(ip);
    if (!h || h.resetAt < Date.now()) return false;
    return h.n >= IP_MAX_FAILURES;
  }
  fail(ip: string) {
    const now = Date.now();
    const h = this.hits.get(ip);
    if (!h || h.resetAt < now) this.hits.set(ip, { n: 1, resetAt: now + IP_WINDOW_MS });
    else h.n++;
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt < now) this.hits.delete(k);
  }
  reset(ip: string) {
    this.hits.delete(ip);
  }
}

export function authRoutes(d: Deps): RouteDef[] {
  const limiter = new IpLimiter();
  const userPayload = (u: ReturnType<typeof me>, csrf: string) => ({
    user: { id: u.id, username: u.username, displayName: u.displayName, role: u.role, mustChangePassword: u.mustChangePassword },
    csrf,
    timeZone: d.cfg.TZ,
  });

  return [
    route('get', '/healthz', 'public', (_req, res) => {
      const s = d.connections.sendingStatus();
      res.json({ ok: true, sending: s.available, reason: s.reason, queue: d.queue.getStatus(), uptimeSeconds: Math.round(process.uptime()) });
    }),

    route('post', '/api/auth/login', 'public', async (req, res) => {
      const ip = clientIp(req) ?? 'unknown';
      const meta = { ip, userAgent: userAgent(req) };
      if (limiter.blocked(ip)) {
        d.audit.record(ctxOf(req), {
          action: 'auth.login',
          outcome: 'failure',
          reason: 'ip_rate_limited',
          details: { attemptedUsername: typeof req.body?.username === 'string' ? req.body.username.slice(0, 64) : null },
        });
        throw new AppError(429, 'Too many sign-in attempts from this device. Wait 15 minutes, then try again.', 'rate_limited');
      }
      try {
        const r = await d.users.login(req.body?.username, req.body?.password, meta);
        limiter.reset(ip);
        res.cookie(SESSION_COOKIE, r.token, sessionCookieOptions(req, d.sessions.maxAgeMs));
        res.json(userPayload(r.user, d.sessions.csrfFor(r.sessionId)));
      } catch (e) {
        limiter.fail(ip);
        throw e;
      }
    }),

    /** Lets the page know whether it's signed in without producing 401s. */
    route('get', '/api/auth/session', 'public', (req, res) => {
      const look = d.sessions.lookup(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      if (!look.ok) {
        if ((look.reason === 'idle_timeout' || look.reason === 'absolute_timeout') && look.user) {
          d.audit.record(
            { ...ctxOf(req), actor: { userId: look.user.id, username: look.user.username, role: look.user.role }, sessionId: look.sessionId },
            { action: 'auth.session_expired', outcome: 'failure', reason: look.reason, targetType: 'session', targetId: look.sessionId },
          );
        }
        if (look.reason !== 'none') res.clearCookie(SESSION_COOKIE, { path: '/' });
        res.json({ signedIn: false, expired: look.reason === 'idle_timeout' || look.reason === 'absolute_timeout' });
        return;
      }
      res.json({ signedIn: true, ...userPayload(look.user, look.csrf) });
    }),

    route('get', '/api/auth/me', 'signed_in', (req, res) => {
      res.json(userPayload(me(req), req.auth!.csrf));
    }),

    route('post', '/api/auth/logout', 'signed_in', (req, res) => {
      d.sessions.revoke(req.auth!.sessionId, 'logout');
      d.audit.record(ctxOf(req), { action: 'auth.logout', targetType: 'session', targetId: req.auth!.sessionId });
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.json({ ok: true });
    }),

    route('post', '/api/auth/change-password', 'signed_in', async (req, res) => {
      const body = z.object({ currentPassword: z.string().max(1024), newPassword: z.string().max(1024) }).parse(req.body);
      await d.users.changeOwnPassword(ctxOf(req), body.currentPassword, body.newPassword);
      const u = { ...me(req), mustChangePassword: false };
      res.json(userPayload(u, req.auth!.csrf));
    }),
  ];
}
