import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull, lt } from 'drizzle-orm';
import sharp, { type OutputInfo } from 'sharp';
import { SYSTEM, type AuditContext, type AuditLog } from './audit.js';
import type { Db } from './db/index.js';
import { uploads } from './db/schema.js';
import { AppError, notFound } from './errors.js';
import { sha256 } from './message.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 1600;
const QUALITY = 82;

export type UploadRow = typeof uploads.$inferSelect;

/** Detects the real type from the first bytes (never trusts the file name or the browser). */
export function sniffImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Stores message images: content-sniffed, re-encoded to JPEG (≤1600 px, q82) with ALL
 * metadata (EXIF, GPS, ICC…) removed, under DATA_DIR/uploads with random names.
 */
export class Images {
  readonly dir: string;

  constructor(
    private db: Db,
    dataDir: string,
    private audit: AuditLog,
  ) {
    this.dir = path.join(dataDir, 'uploads');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  fileOf(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw notFound('That image was not found.');
    return path.join(this.dir, `${id}.jpg`);
  }

  async store(ctx: AuditContext, userId: number, buf: Buffer, originalName: string): Promise<UploadRow> {
    const name = (originalName || 'image').replace(/[\\/\r\n\t]/g, '_').slice(0, 200);
    const fail = (reason: string, msg: string, status = 400): never => {
      this.audit.record(ctx, { action: 'upload.rejected', outcome: 'failure', reason, details: { originalName: name, size: buf.length } });
      throw new AppError(status, msg, reason);
    };
    if (buf.length === 0) fail('empty', 'The file is empty.');
    if (buf.length > MAX_IMAGE_BYTES) fail('too_large', 'The image is larger than 5 MB. Use a smaller image.', 413);
    const type = sniffImageType(buf);
    if (!type) fail('not_an_image', 'That file is not a JPG, PNG or WebP image (checked from its content, not its name).', 415);

    let out: { data: Buffer; info: OutputInfo };
    try {
      out = await sharp(buf, { failOn: 'error', limitInputPixels: 50_000_000 })
        .rotate() // apply the EXIF orientation before the metadata is dropped
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }) // transparent PNG/WebP → white, like WhatsApp
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer({ resolveWithObject: true }); // sharp writes no metadata unless asked to
    } catch (e) {
      return fail('corrupt', `The image could not be read (${e instanceof Error ? e.message.slice(0, 120) : 'unknown error'}). Try another file.`);
    }

    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(this.fileOf(id), out.data, { mode: 0o640 });
    const row = this.db
      .insert(uploads)
      .values({
        id,
        userId,
        originalName: name,
        originalSize: buf.length,
        originalType: type!,
        originalSha256: sha256(buf),
        size: out.data.length,
        width: out.info.width,
        height: out.info.height,
        sha256: sha256(out.data),
        createdAt: Date.now(),
      })
      .returning()
      .get();
    this.audit.record(ctx, {
      action: 'upload.created',
      targetType: 'upload',
      targetId: id,
      details: { originalName: name, originalSize: buf.length, originalType: type, originalSha256: row.originalSha256, size: row.size, width: row.width, height: row.height },
    });
    return row;
  }

  get(id: string): UploadRow | undefined {
    if (!/^[a-f0-9]{32}$/.test(id)) return undefined;
    return this.db.select().from(uploads).where(eq(uploads.id, id)).get();
  }

  /** The upload if it exists, isn't expired, and this user may use it. */
  usable(id: string, userId: number, isAdmin: boolean): UploadRow {
    const u = this.get(id);
    if (!u || u.deletedAt || !fs.existsSync(this.fileOf(id))) throw new AppError(400, 'The attached image has expired or was removed. Attach it again.', 'image_missing');
    if (!isAdmin && u.userId !== userId) throw new AppError(403, 'You can only send images you uploaded yourself.', 'not_owner');
    return u;
  }

  /** Retention: deletes image files older than `days` and logs how many. */
  prune(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    const old = this.db
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(lt(uploads.createdAt, cutoff), isNull(uploads.deletedAt)))
      .all();
    for (const u of old) {
      fs.rmSync(this.fileOf(u.id), { force: true });
      this.db.update(uploads).set({ deletedAt: Date.now() }).where(eq(uploads.id, u.id)).run();
    }
    this.audit.record(SYSTEM, { action: 'system.uploads_pruned', details: { removed: old.length, retentionDays: days } });
    return old.length;
  }
}
