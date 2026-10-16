import type { Response } from 'express';
import type { Role } from './db/schema.js';

interface SseClient {
  res: Response;
  userId: number;
  role: Role;
  /** Re-validates the session; the stream is closed when it returns false. */
  stillValid: () => boolean;
}

/** Server-Sent Events fan-out, filtered by user/role. */
export class EventHub {
  private clients = new Set<SseClient>();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    // Comment lines keep proxies from closing idle connections; also drop ended sessions.
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.stillValid()) {
          this.write(c.res, 'signed_out', {});
          c.res.end();
          this.clients.delete(c);
        } else c.res.write(': ping\n\n');
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  add(res: Response, who: Omit<SseClient, 'res'>, initial: Record<string, unknown>) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    for (const [event, data] of Object.entries(initial)) this.write(res, event, data);
    const client = { res, ...who };
    this.clients.add(client);
    res.on('close', () => this.clients.delete(client));
  }

  /** Everyone signed in. */
  all(event: string, data: unknown) {
    for (const c of this.clients) this.write(c.res, event, data);
  }

  admins(event: string, data: unknown) {
    for (const c of this.clients) if (c.role === 'ADMIN') this.write(c.res, event, data);
  }

  /** Admins plus one specific user (e.g. the owner of a job). */
  adminsAnd(userId: number, event: string, data: unknown) {
    for (const c of this.clients) if (c.role === 'ADMIN' || c.userId === userId) this.write(c.res, event, data);
  }

  /** Ends all streams of a user (forced sign-out, disable, role change). */
  disconnectUser(userId: number) {
    for (const c of this.clients) {
      if (c.userId !== userId) continue;
      this.write(c.res, 'signed_out', {});
      c.res.end();
      this.clients.delete(c);
    }
  }

  private write(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }
}
