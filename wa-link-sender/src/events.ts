import type { Response } from 'express';

/** Fan-out of server events to every open browser tab via Server-Sent Events. */
export class EventHub {
  private clients = new Set<Response>();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    // Comment lines keep proxies from closing idle connections.
    this.heartbeat = setInterval(() => {
      for (const res of this.clients) res.write(': ping\n\n');
    }, 25_000);
    this.heartbeat.unref();
  }

  add(res: Response, initial: Record<string, unknown>) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    for (const [event, data] of Object.entries(initial)) this.write(res, event, data);
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  emit(event: string, data: unknown) {
    for (const res of this.clients) this.write(res, event, data);
  }

  private write(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
