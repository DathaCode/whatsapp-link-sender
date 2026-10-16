import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { parseConfig, type Config } from '../src/config.js';
import type { WaRuntime } from '../src/connections.js';
import { auditLog } from '../src/db/schema.js';
import { createApp } from '../src/http/app.js';
import { logger } from '../src/logger.js';
import { createServices } from '../src/services.js';
import type { GroupInfo, WaRuntimeState } from '../src/whatsapp.js';

logger.level = 'silent';

export const ADMIN = { username: 'admin', password: 'admin-initial-pw-123' };

/** In-memory stand-in for a WhatsApp phone + browser. */
export class FakeWorld {
  runtimes: FakeRuntime[] = [];
  linked = new Set<string>();
  groups: GroupInfo[] = [
    { id: '111@g.us', name: 'Alpha group', readOnly: false },
    { id: '222@g.us', name: 'Beta group', readOnly: false },
    { id: '333@g.us', name: 'Gamma group', readOnly: false },
    { id: '444@g.us', name: 'Admins only', readOnly: true },
  ];
  sent: { clientId: string; to: string; text: string }[] = [];
  failFor = new Set<string>();
  latest() {
    return this.runtimes[this.runtimes.length - 1]!;
  }
}

export class FakeRuntime extends EventEmitter implements WaRuntime {
  state: WaRuntimeState = 'stopped';
  qr: string | null = null;
  lastError: string | null = null;
  nextRetryAt: number | null = null;
  phone = '94770000001';

  constructor(
    readonly clientId: string,
    private world: FakeWorld,
  ) {
    super();
  }

  private set(state: WaRuntimeState) {
    this.state = state;
    this.emit('state', state);
  }

  start() {
    this.world.runtimes.push(this);
    this.set('starting');
    queueMicrotask(() => {
      if (this.world.linked.has(this.clientId)) this.becomeReady();
      else {
        this.qr = 'data:image/png;base64,FAKE';
        this.set('qr');
        this.emit('qr', this.qr);
      }
    });
  }

  /** The phone scans the QR code. */
  scan(phone = this.phone) {
    this.phone = phone;
    this.world.linked.add(this.clientId);
    this.set('authenticating');
    this.becomeReady();
  }

  becomeReady() {
    this.set('ready');
    this.emit('ready', { phone: this.phone, pushName: 'Test Phone' });
  }

  async stop() {
    this.set('stopped');
  }
  async logout() {
    this.world.linked.delete(this.clientId);
    this.set('stopped');
  }
  isReady() {
    return this.state === 'ready';
  }
  async listGroups() {
    return this.world.groups;
  }
  async sendText(to: string, text: string) {
    if (this.world.failFor.has(to)) throw new Error('boom');
    this.world.sent.push({ clientId: this.clientId, to, text });
  }
}

export function testConfig(dataDir: string, overrides: Record<string, string> = {}): Config {
  const r = parseConfig({
    DATA_DIR: dataDir,
    WWEBJS_AUTH_DIR: path.join(dataDir, 'auth'),
    WWEBJS_CACHE_DIR: path.join(dataDir, 'cache'),
    SESSION_SECRET: 'test-secret-test-secret-test-secret-0123',
    INITIAL_ADMIN_USERNAME: ADMIN.username,
    INITIAL_ADMIN_PASSWORD: ADMIN.password,
    TRUST_PROXY: 'false',
    LOG_LEVEL: 'silent',
    SEND_WINDOW_START: '00:00',
    SEND_WINDOW_END: '23:59',
    ...overrides,
  });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.config;
}

/** Signed-in HTTP client: keeps the cookie and sends the CSRF header. */
export class Client {
  csrf = '';
  constructor(public agent: ReturnType<typeof request.agent>) {}

  async login(username: string, password: string) {
    const r = await this.agent.post('/api/auth/login').send({ username, password });
    if (r.status === 200) this.csrf = r.body.csrf;
    return r;
  }
  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body: unknown = {}) {
    return this.agent.post(url).set('x-csrf-token', this.csrf).send(body as object);
  }
  put(url: string, body: unknown = {}) {
    return this.agent.put(url).set('x-csrf-token', this.csrf).send(body as object);
  }
  del(url: string) {
    return this.agent.delete(url).set('x-csrf-token', this.csrf);
  }
}

export async function harness(env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wls-'));
  const cfg = testConfig(dir, env);
  const world = new FakeWorld();
  const svc = createServices(cfg, logger, { runtimeFactory: (id) => new FakeRuntime(id, world) });
  await svc.users.ensureInitialAdmin();
  svc.catalog.seedTemplates();
  const { app, routes } = createApp({ cfg, log: logger, publicDir: path.join(dir, 'public'), ...svc });

  const client = () => new Client(request.agent(app));

  /** Admin that has already replaced the initial password. */
  const admin = async (newPassword = 'admin-new-password-1') => {
    const c = client();
    await c.login(ADMIN.username, ADMIN.password);
    await c.post('/api/auth/change-password', { currentPassword: ADMIN.password, newPassword });
    return c;
  };

  /** Creates a USER via the admin API and returns them signed in with a changed password. */
  const makeUser = async (adminClient: Client, username: string, presetIds: number[] = []) => {
    const r = await adminClient.post('/api/admin/users', { username, displayName: username, role: 'USER', presetIds });
    if (r.status !== 201) throw new Error(`create user failed: ${JSON.stringify(r.body)}`);
    const c = client();
    await c.login(username, r.body.temporaryPassword);
    const pw = `${username}-password-xyz`;
    await c.post('/api/auth/change-password', { currentPassword: r.body.temporaryPassword, newPassword: pw });
    return { client: c, id: r.body.user.id as number, password: pw };
  };

  /** Adds a WhatsApp number, scans it and loads groups. */
  const linkConnection = async (adminClient: Client, label = 'Main number', phone?: string) => {
    const r = await adminClient.post('/api/admin/connections', { label });
    await tick();
    world.latest().scan(phone);
    await tick();
    await adminClient.post('/api/admin/groups/refresh'); // the app does this on connect
    return r.body.connection.id as number;
  };

  const actions = () => svc.db.select().from(auditLog).all();

  const close = async () => {
    await svc.queue.stop();
    await svc.connections.stopAll();
    svc.hub.close();
    svc.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };

  return { dir, cfg, svc, app, routes, world, client, admin, makeUser, linkConnection, actions, close };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await tick(10);
  }
}
