import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import wwebjs from 'whatsapp-web.js';
import type { Config } from './config.js';
import type { Group } from './db.js';
import type { Logger } from './logger.js';

const { Client, LocalAuth } = wwebjs;
type WClient = InstanceType<typeof Client>;

export type WaState = 'starting' | 'qr' | 'authenticating' | 'ready' | 'reconnecting' | 'stopped';

export interface WaStatus {
  state: WaState;
  /** QR code as a data: URL while waiting to be linked */
  qr: string | null;
  account: { name: string; phone: string } | null;
  lastError: string | null;
  nextRetryAt: number | null;
  since: number;
}

const CHROMIUM_LOCKS = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
const INIT_TIMEOUT_MS = 3 * 60_000;
const WATCHDOG_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Owns the whatsapp-web.js client: start, QR, reconnect with backoff, watchdog,
 * logout and graceful shutdown. Every (re)start creates a brand-new Client, because
 * re-initializing a client whose browser died is what made the old version crash.
 */
export class WhatsApp extends EventEmitter {
  private client: WClient | null = null;
  private generation = 0;
  private attempts = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private watchdogFailures = 0;
  private stopping = false;
  private restarting = false;
  private status: WaStatus = {
    state: 'starting',
    qr: null,
    account: null,
    lastError: null,
    nextRetryAt: null,
    since: Date.now(),
  };

  constructor(
    private cfg: Config,
    private log: Logger,
  ) {
    super();
  }

  get sessionDir() {
    return path.join(this.cfg.WWEBJS_AUTH_DIR, 'session');
  }

  getStatus(): WaStatus {
    return { ...this.status };
  }

  isReady() {
    return this.status.state === 'ready' && this.client !== null;
  }

  private setStatus(patch: Partial<WaStatus>) {
    const changedState = patch.state && patch.state !== this.status.state;
    this.status = { ...this.status, ...patch, ...(changedState ? { since: Date.now() } : {}) };
    if (changedState) this.log.info({ state: this.status.state }, 'whatsapp state');
    this.emit('status', this.getStatus());
  }

  /** Removes Chromium profile locks left behind when a container was killed. */
  removeStaleLocks() {
    for (const name of CHROMIUM_LOCKS) {
      const p = path.join(this.sessionDir, name);
      try {
        fs.lstatSync(p); // lstat: these are often dangling symlinks
        fs.rmSync(p, { force: true });
        this.log.info({ file: name }, 'removed stale Chromium lock');
      } catch {
        /* not present */
      }
    }
  }

  start() {
    this.stopping = false;
    void this.launch();
  }

  private async launch() {
    if (this.stopping) return;
    const gen = ++this.generation;
    this.retryTimer = null;
    this.removeStaleLocks();
    this.setStatus({ state: this.attempts === 0 ? 'starting' : 'reconnecting', qr: null, nextRetryAt: null });

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: this.cfg.WWEBJS_AUTH_DIR }),
      webVersionCache: { type: 'local', path: this.cfg.WWEBJS_CACHE_DIR },
      puppeteer: {
        headless: this.cfg.HEADLESS,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
        ],
      },
    });
    this.client = client;
    const current = () => gen === this.generation && !this.stopping;

    client.on('qr', async (qr: string) => {
      if (!current()) return;
      this.attempts = 0;
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      if (current()) this.setStatus({ state: 'qr', qr: dataUrl, lastError: null });
    });
    client.on('authenticated', () => {
      if (current()) this.setStatus({ state: 'authenticating', qr: null });
    });
    client.on('auth_failure', (msg: string) => {
      if (!current()) return;
      this.log.error({ msg }, 'whatsapp auth failure, clearing saved session');
      void this.restart('Saved login was rejected by WhatsApp. Scan the QR code again.', { wipeSession: true });
    });
    client.on('ready', () => {
      if (!current()) return;
      this.attempts = 0;
      this.watchdogFailures = 0;
      const info = client.info;
      this.setStatus({
        state: 'ready',
        qr: null,
        lastError: null,
        account: info ? { name: info.pushname ?? '', phone: info.wid?.user ?? '' } : null,
      });
      this.startWatchdog(gen);
      this.emit('ready');
    });
    client.on('disconnected', (reason: string) => {
      if (!current()) return;
      this.log.warn({ reason }, 'whatsapp disconnected');
      const loggedOut = reason === 'LOGOUT' || reason === 'UNPAIRED' || reason === 'UNPAIRED_IDLE';
      void this.restart(
        loggedOut ? 'This number was unlinked from the phone. Scan the QR code to link it again.' : `Disconnected (${reason})`,
        { wipeSession: loggedOut, immediate: loggedOut },
      );
    });

    try {
      await withTimeout(client.initialize(), INIT_TIMEOUT_MS, 'WhatsApp start-up');
      if (!current()) return;
      client.pupBrowser?.on('disconnected', () => {
        if (current()) void this.restart('The built-in browser closed unexpectedly');
      });
    } catch (e) {
      if (!current()) return;
      this.log.error({ err: errText(e) }, 'whatsapp failed to start');
      void this.restart(`Could not start WhatsApp: ${errText(e)}`);
    }
  }

  private startWatchdog(gen: number) {
    this.stopWatchdog();
    this.watchdog = setInterval(async () => {
      if (gen !== this.generation || !this.client || this.status.state !== 'ready') return;
      try {
        const state = await withTimeout(this.client.getState(), 20_000, 'state check');
        if (state === 'CONNECTED') {
          this.watchdogFailures = 0;
          return;
        }
        this.watchdogFailures++;
        this.log.warn({ state, failures: this.watchdogFailures }, 'watchdog: not connected');
      } catch (e) {
        this.watchdogFailures++;
        this.log.warn({ err: errText(e), failures: this.watchdogFailures }, 'watchdog: state check failed');
      }
      if (this.watchdogFailures >= 3) void this.restart('Connection stopped responding');
    }, WATCHDOG_MS);
    this.watchdog.unref();
  }

  private stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private async destroyClient() {
    const client = this.client;
    this.client = null;
    this.stopWatchdog();
    if (!client) return;
    client.removeAllListeners();
    try {
      await withTimeout(client.destroy(), 20_000, 'browser shutdown');
    } catch (e) {
      this.log.warn({ err: errText(e) }, 'browser did not close cleanly; killing it');
      try {
        client.pupBrowser?.process()?.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }

  private wipeSession() {
    try {
      fs.rmSync(this.sessionDir, { recursive: true, force: true, maxRetries: 3 });
      this.log.info('saved WhatsApp session removed');
    } catch (e) {
      this.log.error({ err: errText(e) }, 'could not remove saved session');
    }
  }

  /** Tears the client down and starts a new one after an exponential backoff. */
  private async restart(reason: string, opts: { wipeSession?: boolean; immediate?: boolean } = {}) {
    if (this.stopping || this.restarting) return;
    this.restarting = true;
    this.generation++; // ignore any late events from the old client
    try {
      this.setStatus({ state: 'reconnecting', qr: null, lastError: reason });
      await this.destroyClient();
      if (opts.wipeSession) this.wipeSession();
      this.attempts++;
      const delay = opts.immediate
        ? 1000
        : Math.min(MAX_BACKOFF_MS, 5000 * 2 ** (this.attempts - 1)) + Math.floor(Math.random() * 2000);
      this.log.info({ attempt: this.attempts, delayMs: delay, reason }, 'whatsapp restart scheduled');
      this.setStatus({ nextRetryAt: Date.now() + delay });
      if (!this.stopping) this.retryTimer = setTimeout(() => void this.launch(), delay);
    } finally {
      this.restarting = false;
    }
  }

  /** "Unlink WhatsApp": log out on WhatsApp's side, wipe the session and show a fresh QR. */
  async logout() {
    const client = this.client;
    this.generation++;
    if (client && this.status.state === 'ready') {
      try {
        await withTimeout(client.logout(), 30_000, 'logout');
      } catch (e) {
        this.log.warn({ err: errText(e) }, 'logout call failed; wiping session locally');
      }
    }
    await this.destroyClient();
    this.wipeSession();
    this.attempts = 0;
    this.setStatus({ account: null, lastError: null });
    if (!this.stopping) void this.launch();
  }

  /**
   * Lists groups straight from WhatsApp Web's chat collection.
   * We avoid client.getChats(): in whatsapp-web.js 1.34.7 it also loads every chat's last
   * message, which fails inside WhatsApp Web (IndexedDB "No key or key range specified").
   * Membership/admin checks use WhatsApp's own iAmMember/iAmAdmin, because participants
   * are now listed by LID, not phone number.
   */
  async listGroups(): Promise<Group[]> {
    const client = this.requireClient();
    const page = client.pupPage;
    if (!page) throw new NotConnectedError();
    const groups = await withTimeout(
      page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- WhatsApp Web internals are untyped
        const w = window as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chats: any[] = w.require('WAWebCollections').Chat.getModelsArray();
        return chats
          .filter((c) => c?.id?.server === 'g.us' && c.groupMetadata)
          .map((c) => {
            const gm = c.groupMetadata;
            const p = gm.participants;
            const call = (fn: string, fallback: boolean) => {
              try {
                return typeof p?.[fn] === 'function' ? Boolean(p[fn]()) : fallback;
              } catch {
                return fallback;
              }
            };
            const member = call('iAmMember', true);
            const admin = call('iAmAdmin', false) || call('iAmSuperAdmin', false);
            const adminsOnly = Boolean(gm.announce) && !admin;
            return {
              id: String(c.id._serialized),
              name: String(c.formattedTitle || c.name || gm.subject || c.id.user),
              readOnly: !member || adminsOnly || c.isReadOnly === true,
            };
          });
      }),
      60_000,
      'Loading groups',
    );
    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Sends a text message to a group, showing "typing…" for a moment first like a person would. */
  async sendText(groupId: string, text: string) {
    const client = this.requireClient();
    const page = client.pupPage;
    const chatstate = (state: 'typing' | 'stop') =>
      page?.evaluate(
        (id, st) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).WWebJS.sendChatstate(st, id);
        },
        groupId,
        state,
      );
    try {
      await withTimeout(Promise.resolve(chatstate('typing')), 10_000, 'Typing indicator');
      await sleep(1500 + Math.random() * 2500);
      await withTimeout(Promise.resolve(chatstate('stop')), 10_000, 'Typing indicator');
    } catch (e) {
      // Cosmetic only; a missing chat will fail properly in sendMessage.
      this.log.debug({ err: errText(e) }, 'typing indicator skipped');
    }
    const sent = await withTimeout(
      // sendSeen:false avoids a known breakage in recent WhatsApp Web builds.
      client.sendMessage(groupId, text, { sendSeen: false, linkPreview: true }),
      60_000,
      'Sending',
    );
    if (!sent) throw new Error('chat not found');
  }

  private requireClient(): WClient {
    if (!this.client || this.status.state !== 'ready') throw new NotConnectedError();
    return this.client;
  }

  async stop() {
    this.stopping = true;
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.destroyClient();
    this.setStatus({ state: 'stopped' });
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super('WhatsApp is not connected right now.');
  }
}
