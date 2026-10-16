import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import wwebjs from 'whatsapp-web.js';
import type { Config } from './config.js';
import { classifyGroups, type GroupInfo, type RawChat } from './groups.js';
import type { SendMode } from './jobs.js';
import type { Logger } from './logger.js';

const { Client, LocalAuth, MessageMedia } = wwebjs;
type WClient = InstanceType<typeof Client>;

export type WaRuntimeState = 'starting' | 'qr' | 'authenticating' | 'ready' | 'reconnecting' | 'stopped';

export type { GroupInfo } from './groups.js';

const CHROMIUM_LOCKS = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
const INIT_TIMEOUT_MS = 3 * 60_000;
const WATCHDOG_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const BAN_STATES = new Set(['TOS_BLOCK', 'SMB_TOS_BLOCK']);

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function sessionDirFor(authDir: string, clientId: string) {
  return path.join(authDir, `session-${clientId}`);
}

/**
 * One WhatsApp number = one whatsapp-web.js client with its own LocalAuth clientId
 * (session folder). Handles QR, transient reconnects with backoff and a watchdog.
 * It does NOT decide what to do after a logout/ban: it reports and stops, and the
 * ConnectionManager decides.
 *
 * Events:
 *   state (WaRuntimeState) · qr (dataUrl) · ready ({ phone, pushName })
 *   disconnected (reason) · reconnect ({ attempt, delayMs, reason }) · start_failed (error)
 *   logged_out ({ reason, suspectedBan })
 */
export class WaClient extends EventEmitter {
  private client: WClient | null = null;
  private generation = 0;
  private attempts = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private watchdogFailures = 0;
  private stopped = true;
  private restarting = false;
  state: WaRuntimeState = 'stopped';
  qr: string | null = null;
  lastError: string | null = null;
  nextRetryAt: number | null = null;

  constructor(
    readonly clientId: string,
    private cfg: Config,
    private log: Logger,
  ) {
    super();
  }

  get sessionDir() {
    return sessionDirFor(this.cfg.WWEBJS_AUTH_DIR, this.clientId);
  }

  isReady() {
    return this.state === 'ready' && this.client !== null;
  }

  private setState(state: WaRuntimeState) {
    if (state === this.state) return;
    this.state = state;
    if (state !== 'qr') this.qr = null;
    this.log.info({ clientId: this.clientId, state }, 'whatsapp state');
    this.emit('state', state);
  }

  /** Removes Chromium profile locks left behind when a container was killed. */
  removeStaleLocks() {
    for (const name of CHROMIUM_LOCKS) {
      const p = path.join(this.sessionDir, name);
      try {
        fs.lstatSync(p); // lstat: these are often dangling symlinks
        fs.rmSync(p, { force: true });
        this.log.info({ clientId: this.clientId, file: name }, 'removed stale Chromium lock');
      } catch {
        /* not present */
      }
    }
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    void this.launch();
  }

  private async launch() {
    if (this.stopped) return;
    const gen = ++this.generation;
    this.retryTimer = null;
    this.nextRetryAt = null;
    this.removeStaleLocks();
    this.setState(this.attempts === 0 ? 'starting' : 'reconnecting');

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: this.clientId, dataPath: this.cfg.WWEBJS_AUTH_DIR }),
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
    const current = () => gen === this.generation && !this.stopped;

    client.on('qr', async (qr: string) => {
      if (!current()) return;
      this.attempts = 0;
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      if (!current()) return;
      this.qr = dataUrl;
      this.setState('qr');
      this.emit('qr', dataUrl);
    });
    client.on('authenticated', () => {
      if (current()) this.setState('authenticating');
    });
    client.on('auth_failure', (msg: string) => {
      if (!current()) return;
      this.log.error({ clientId: this.clientId, msg }, 'whatsapp auth failure');
      void this.handleLoggedOut('WhatsApp rejected the saved login', false);
    });
    client.on('ready', () => {
      if (!current()) return;
      this.attempts = 0;
      this.watchdogFailures = 0;
      this.lastError = null;
      const info = client.info;
      this.setState('ready');
      this.startWatchdog(gen);
      this.emit('ready', { phone: info?.wid?.user ?? null, pushName: info?.pushname ?? null });
    });
    client.on('change_state', (state: string) => {
      if (!current()) return;
      if (BAN_STATES.has(state)) void this.handleLoggedOut(`WhatsApp reported ${state}`, true);
    });
    client.on('disconnected', (reason: string) => {
      if (!current()) return;
      this.log.warn({ clientId: this.clientId, reason }, 'whatsapp disconnected');
      if (reason === 'LOGOUT' || reason === 'UNPAIRED' || reason === 'UNPAIRED_IDLE') {
        void this.handleLoggedOut(`WhatsApp logged this number out (${reason})`, false);
      } else if (BAN_STATES.has(reason)) {
        void this.handleLoggedOut(`WhatsApp reported ${reason}`, true);
      } else {
        this.emit('disconnected', reason);
        void this.restart(`Disconnected (${reason})`);
      }
    });

    try {
      await withTimeout(client.initialize(), INIT_TIMEOUT_MS, 'WhatsApp start-up');
      if (!current()) return;
      client.pupBrowser?.on('disconnected', () => {
        if (current()) void this.restart('The built-in browser closed unexpectedly');
      });
    } catch (e) {
      if (!current()) return;
      this.log.error({ clientId: this.clientId, err: errText(e) }, 'whatsapp failed to start');
      this.emit('start_failed', errText(e));
      void this.restart(`Could not start WhatsApp: ${errText(e)}`);
    }
  }

  private startWatchdog(gen: number) {
    this.stopWatchdog();
    this.watchdog = setInterval(async () => {
      if (gen !== this.generation || !this.client || this.state !== 'ready') return;
      try {
        const state = await withTimeout(this.client.getState(), 20_000, 'state check');
        if (state === 'CONNECTED') {
          this.watchdogFailures = 0;
          return;
        }
        if (BAN_STATES.has(String(state))) {
          void this.handleLoggedOut(`WhatsApp reported ${state}`, true);
          return;
        }
        this.watchdogFailures++;
        this.log.warn({ clientId: this.clientId, state, failures: this.watchdogFailures }, 'watchdog: not connected');
      } catch (e) {
        this.watchdogFailures++;
        this.log.warn({ clientId: this.clientId, err: errText(e), failures: this.watchdogFailures }, 'watchdog: state check failed');
      }
      if (this.watchdogFailures >= 3) {
        this.emit('disconnected', 'watchdog');
        void this.restart('Connection stopped responding');
      }
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
      this.log.warn({ clientId: this.clientId, err: errText(e) }, 'browser did not close cleanly; killing it');
      try {
        client.pupBrowser?.process()?.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }

  /** Transient problem: tear down and start a new client after an exponential backoff. */
  private async restart(reason: string) {
    if (this.stopped || this.restarting) return;
    this.restarting = true;
    this.generation++; // ignore late events from the old client
    try {
      this.lastError = reason;
      this.setState('reconnecting');
      await this.destroyClient();
      this.attempts++;
      const delayMs = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** (this.attempts - 1)) + Math.floor(Math.random() * 2000);
      this.nextRetryAt = Date.now() + delayMs;
      this.log.info({ clientId: this.clientId, attempt: this.attempts, delayMs, reason }, 'whatsapp restart scheduled');
      this.emit('reconnect', { attempt: this.attempts, delayMs, reason });
      if (!this.stopped) this.retryTimer = setTimeout(() => void this.launch(), delayMs);
    } finally {
      this.restarting = false;
    }
  }

  /** Logged out or blocked: stop for good and let the manager decide. */
  private async handleLoggedOut(reason: string, suspectedBan: boolean) {
    if (this.stopped) return;
    this.lastError = reason;
    this.emit('logged_out', { reason, suspectedBan });
    await this.stop();
  }

  /** Logs out on WhatsApp's side (removes the linked device on the phone), then stops. */
  async logout() {
    const client = this.client;
    this.generation++;
    if (client && this.state === 'ready') {
      try {
        await withTimeout(client.logout(), 30_000, 'logout');
      } catch (e) {
        this.log.warn({ clientId: this.clientId, err: errText(e) }, 'logout call failed');
      }
    }
    await this.stop();
  }

  wipeSession() {
    try {
      fs.rmSync(this.sessionDir, { recursive: true, force: true, maxRetries: 3 });
      this.log.info({ clientId: this.clientId }, 'saved WhatsApp session removed');
    } catch (e) {
      this.log.error({ clientId: this.clientId, err: errText(e) }, 'could not remove saved session');
    }
  }

  /**
   * Reads every chat from WhatsApp Web's own chat collection, plus each group's metadata,
   * including WhatsApp Community fields. With `fresh`, each group's metadata is first
   * re-fetched from WhatsApp's servers (GroupMetadata.update), so nothing comes from a stale cache.
   * We avoid client.getChats(): in whatsapp-web.js 1.34.7 it also loads every chat's last message,
   * which fails inside WhatsApp Web (IndexedDB "No key or key range specified").
   */
  async inspectChats(fresh: boolean): Promise<RawChat[]> {
    const page = this.requireClient().pupPage;
    if (!page) throw new NotConnectedError();
    const result = await withTimeout(
      page.evaluate(async (fresh: boolean) => {
        /* eslint-disable @typescript-eslint/no-explicit-any -- WhatsApp Web internals are untyped */
        const w = window as any;
        const C = w.require('WAWebCollections');
        const WidF = w.require('WAWebWidFactory');
        const GM = C.GroupMetadata || C.WAWebGroupMetadataCollection;
        const chats: any[] = C.Chat.getModelsArray();
        const idOf = (v: any): string | null => (!v ? null : typeof v === 'string' ? v : (v._serialized ?? null));
        const errors: Record<string, string> = {};

        if (fresh && GM?.update) {
          const groupChats = chats.filter((c) => c?.id?.server === 'g.us');
          for (let i = 0; i < groupChats.length; i += 8) {
            await Promise.all(
              groupChats.slice(i, i + 8).map(async (c) => {
                try {
                  await Promise.race([
                    GM.update(WidF.createWid(c.id._serialized)),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15_000)),
                  ]);
                } catch (e: any) {
                  errors[c.id._serialized] = String(e?.message ?? e).slice(0, 200);
                }
              }),
            );
          }
        }

        const titleOf = (id: string | null): string | null => {
          if (!id) return null;
          try {
            const ch = C.Chat.get(id);
            if (ch) return ch.formattedTitle || ch.name || null;
            return GM?.get?.(id)?.subject ?? null;
          } catch {
            return null;
          }
        };
        const listSubgroups = (arr: any) =>
          (Array.isArray(arr) ? arr : (arr?.getModelsArray?.() ?? []))
            .map((s: any) => ({ id: idOf(s?.id ?? s?.groupId ?? s), subject: s?.subject ?? null }))
            .filter((s: { id: string | null }) => !!s.id);

        return chats.map((c) => {
          const id: string = c.id._serialized;
          const isGroup = c.id.server === 'g.us';
          const gm = isGroup ? c.groupMetadata || GM?.get?.(id) : null;
          let raw: any = {};
          try {
            raw = gm?.serialize ? gm.serialize() : {};
          } catch {
            raw = {};
          }
          const p = gm?.participants;
          const call = (fn: string): boolean | null => {
            try {
              return typeof p?.[fn] === 'function' ? Boolean(p[fn]()) : null;
            } catch {
              return null;
            }
          };
          const admin = call('iAmAdmin');
          const superAdmin = call('iAmSuperAdmin');
          const parentGroupId = idOf(raw.parentGroup ?? gm?.parentGroup);
          const size = raw.size ?? gm?.size;
          return {
            id,
            name: c.formattedTitle || c.name || null,
            subject: raw.subject ?? gm?.subject ?? null,
            isGroup,
            archived: !!c.archive,
            isReadOnly: c.isReadOnly === true,
            metaLoaded: !!gm,
            metaError: errors[id] ?? null,
            isParentGroup: !!(raw.isParentGroup ?? gm?.isParentGroup),
            parentGroupId,
            parentGroupName: titleOf(parentGroupId),
            defaultSubgroup: !!(raw.defaultSubgroup ?? gm?.defaultSubgroup ?? raw.isDefaultSubgroup),
            hiddenSubgroup: !!(raw.hiddenSubgroup ?? gm?.hiddenSubgroup),
            announce: !!(raw.announce ?? gm?.announce),
            restrict: !!(raw.restrict ?? gm?.restrict),
            iAmMember: gm ? call('iAmMember') : null,
            iAmAdmin: admin === null && superAdmin === null ? null : !!(admin || superAdmin),
            participants: typeof p?.length === 'number' ? p.length : (p?.getModelsArray?.().length ?? null),
            size: typeof size === 'number' ? size : null,
            unjoinedSubgroups: isGroup ? listSubgroups(raw.unjoinedSubgroups ?? gm?.unjoinedSubgroups) : [],
            rawKeys: Object.keys(raw).sort(),
          };
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */
      }, fresh),
      fresh ? 180_000 : 60_000,
      'Loading groups',
    );
    return result as RawChat[];
  }

  /** Groups this number can see, classified (community / announcement / group) with the reason it can't post. */
  async listGroups(): Promise<GroupInfo[]> {
    return classifyGroups(await this.inspectChats(true));
  }

  /**
   * Sends one post to a group:
   *   - text only: a normal message with link preview
   *   - image + mode "single": the image with the full text as its caption (one message)
   *   - image + mode "two": the image, then the text as its own message (keeps the link preview card)
   * The text is passed through untouched (no normalization, zero-width characters kept).
   *
   * Errors are SendErrors that say whether anything may have reached the group, so the caller
   * only retries when it is safe (sent = 'no').
   */
  async sendPost(groupId: string, post: { text: string; imagePath: string | null; mode: SendMode }) {
    const client = this.requireClient();
    const page = client.pupPage;

    // ---- prepare: nothing has been sent yet ----
    let media: InstanceType<typeof MessageMedia> | null = null;
    try {
      const exists = await withTimeout(
        page!.evaluate(async (id) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return !!(await (window as any).WWebJS.getChat(id, { getAsModel: false }));
        }, groupId),
        30_000,
        'Opening the group',
      );
      if (!exists) throw new Error('chat not found');
      if (post.imagePath) media = MessageMedia.fromFilePath(post.imagePath);
    } catch (e) {
      throw new SendError(errText(e), 'no');
    }

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
      this.log.debug({ clientId: this.clientId, err: errText(e) }, 'typing indicator skipped');
    }

    // ---- send: from here a failure may or may not have reached the group ----
    // whatsapp-web.js 1.34.x returns undefined even for messages that WERE sent (it looks the new
    // message up by a pre-generated id that WhatsApp Web no longer uses), so "no exception" = sent.
    const textOptions = { sendSeen: false, linkPreview: true }; // sendSeen:false avoids a known breakage
    try {
      if (!media) {
        await withTimeout(client.sendMessage(groupId, post.text, textOptions), 60_000, 'Sending');
      } else if (post.mode === 'single') {
        await withTimeout(client.sendMessage(groupId, media, { sendSeen: false, caption: post.text }), 120_000, 'Sending the image');
      } else {
        await withTimeout(client.sendMessage(groupId, media, { sendSeen: false }), 120_000, 'Sending the image');
        try {
          await sleep(1500);
          await withTimeout(client.sendMessage(groupId, post.text, textOptions), 60_000, 'Sending');
        } catch (e) {
          throw new SendError(`The image was sent but the text was not (${errText(e)})`, 'partial');
        }
      }
    } catch (e) {
      if (e instanceof SendError) throw e;
      throw new SendError(errText(e), 'maybe');
    }
  }

  private requireClient(): WClient {
    if (!this.client || this.state !== 'ready') throw new NotConnectedError();
    return this.client;
  }

  async stop() {
    this.stopped = true;
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.nextRetryAt = null;
    await this.destroyClient();
    this.setState('stopped');
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super('WhatsApp is not connected right now.');
  }
}

/**
 * A failed send. `sent` says what may have reached the group:
 *   no      - nothing was sent (safe to retry)
 *   maybe   - WhatsApp may have delivered it (timeout or error during sending): never retried automatically
 *   partial - two-message mode: the image went out, the text did not
 */
export class SendError extends Error {
  constructor(
    message: string,
    public sent: 'no' | 'maybe' | 'partial',
  ) {
    super(message);
  }
}
