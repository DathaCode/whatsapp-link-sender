import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Store } from './db.js';

export const SESSION_COOKIE = 'wls_sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest();

export class Auth {
  /** Sessions are bound to the key, so changing ACCESS_KEY signs everybody out. */
  private keyFp: string;
  private keyHash: Buffer;

  constructor(
    accessKey: string,
    private store: Store,
  ) {
    this.keyHash = sha256(accessKey);
    this.keyFp = this.keyHash.toString('hex').slice(0, 16);
  }

  checkKey(candidate: unknown): boolean {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 1024) return false;
    return crypto.timingSafeEqual(sha256(candidate), this.keyHash);
  }

  login(req: Request, res: Response) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.store.createSession(sha256(token).toString('hex'), this.keyFp, SESSION_TTL_MS);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  logout(req: Request, res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') this.store.deleteSession(sha256(token).toString('hex'));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  isSignedIn(req: Request): boolean {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length > 100) return false;
    const s = this.store.findSession(sha256(token).toString('hex'));
    return !!s && s.expiresAt > Date.now() && s.keyFp === this.keyFp;
  }

  require = (req: Request, res: Response, next: NextFunction) => {
    if (this.isSignedIn(req)) return next();
    res.status(401).json({ error: 'Please sign in again.' });
  };
}

/**
 * Blocks cross-site form posts: state-changing requests must come from this site.
 * (The session cookie is also SameSite=Strict; this is a second, cheap layer.)
 */
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) {
        res.status(403).json({ error: 'This request came from another website and was blocked.' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Blocked a request with a malformed origin.' });
      return;
    }
  }
  if (!req.is('application/json') && req.headers['content-length'] && req.headers['content-length'] !== '0') {
    res.status(415).json({ error: 'Send JSON.' });
    return;
  }
  next();
}
