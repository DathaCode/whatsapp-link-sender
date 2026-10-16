import type { Catalog } from './catalog.js';
import type { Images, UploadRow } from './images.js';
import type { JobStore, SendMode } from './jobs.js';
import {
  CAPTION_MAX,
  TEXT_MAX,
  canonicalLink,
  charCount,
  cleanMessage,
  disallowedHosts,
  isAllowedHost,
  mainLinks,
  normalizeMessage,
  sha256,
  textKey,
  type MessageLink,
} from './message.js';
import type { Settings } from './settings.js';

export interface AnalyzedLink extends MessageLink {
  allowed: boolean;
  /** Counts for duplicate detection (not a snippet/repeating link). */
  main: boolean;
}

export interface Analysis {
  /** Exactly what will be sent (tracking parameters removed, nothing else changed). */
  text: string;
  sha256: string;
  textKey: string;
  chars: number;
  limit: number;
  tooLong: boolean;
  empty: boolean;
  links: AnalyzedLink[];
  disallowed: string[];
  mainLinks: string[];
  mode: SendMode;
  image: UploadRow | null;
  imageError: string | null;
  duplicate: ReturnType<JobStore['findDuplicate']> | null;
}

/**
 * One place that turns what the user typed into what will be sent, with every check the
 * server enforces. Used by the live preview (/api/messages/check) and by sending (/api/jobs).
 */
export class Composer {
  constructor(
    private settings: Settings,
    private catalog: Catalog,
    private images: Images,
    private jobs: JobStore,
  ) {}

  analyze(input: { text: unknown; uploadId?: string | null }, user: { id: number; isAdmin: boolean }): Analysis {
    const messaging = this.settings.messaging();
    const safety = this.settings.get();
    const { text, links } = cleanMessage(normalizeMessage(input.text), messaging.allowedDomains);

    let image: UploadRow | null = null;
    let imageError: string | null = null;
    if (input.uploadId) {
      try {
        image = this.images.usable(input.uploadId, user.id, user.isAdmin);
      } catch (e) {
        imageError = e instanceof Error ? e.message : String(e);
      }
    }

    const mode: SendMode = image ? safety.imageSendMode : 'text';
    const limit = image && mode === 'single' ? CAPTION_MAX : TEXT_MAX;
    const chars = charCount(text);
    const main = mainLinks(
      links,
      this.catalog.listSnippets().map((s) => s.body),
      messaging.repeatingLinks,
    );
    const key = textKey(text);
    return {
      text,
      sha256: sha256(text),
      textKey: key,
      chars,
      limit,
      tooLong: chars > limit,
      empty: chars === 0,
      links: links.map((l) => ({ ...l, allowed: isAllowedHost(l.host, messaging.allowedDomains), main: main.includes(canonicalLink(l.cleaned)) })),
      disallowed: disallowedHosts(links, messaging.allowedDomains),
      mainLinks: main,
      mode,
      image,
      imageError,
      duplicate: chars ? (this.jobs.findDuplicate({ textKey: key, imageSha256: image?.originalSha256 ?? null, mainLinks: main }) ?? null) : null,
    };
  }
}

/** Image facts for responses and audit rows (never the file path). */
export const imageInfo = (u: UploadRow | null) =>
  u
    ? {
        id: u.id,
        originalName: u.originalName,
        originalSize: u.originalSize,
        originalType: u.originalType,
        originalSha256: u.originalSha256,
        processedSha256: u.sha256,
        size: u.size,
        width: u.width,
        height: u.height,
      }
    : null;
