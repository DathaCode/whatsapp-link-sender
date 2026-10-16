import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { diff, SYSTEM, type AuditContext, type AuditLog } from './audit.js';
import type { Db } from './db/index.js';
import { presetAccess, presetGroups, presets, snippets } from './db/schema.js';
import { conflict, notFound } from './errors.js';

export interface PresetView {
  id: number;
  name: string;
  groups: { id: string; name: string }[];
  userIds: number[];
}

export interface Snippet {
  id: number;
  name: string;
  body: string;
}

const DEFAULT_SNIPPETS: { name: string; body: string }[] = [
  {
    name: 'Follow us footer',
    body: [
      'F𝗢𝗟𝗟𝗢𝗪 𝗨𝗦 𝗢𝗡',
      '',
      '🟠  YouTube👉 https://www.youtube.com/@HiruNewsOfficial',
      '',
      '🟠  Facebook 👉 https://www.facebook.com/hirunews',
      '',
      '🟠  TikTok 👉 https://www.tiktok.com/@hirunews',
    ].join('\n'),
  },
];

/** Presets (named group lists) and reusable text snippets. */
export class Catalog {
  constructor(
    private db: Db,
    private audit: AuditLog,
  ) {}

  seedSnippets() {
    const n = this.db.select({ n: count() }).from(snippets).get()?.n ?? 0;
    if (n > 0) return;
    const now = Date.now();
    this.db
      .insert(snippets)
      .values(DEFAULT_SNIPPETS.map((t, i) => ({ ...t, sort: i, updatedAt: now })))
      .run();
    this.audit.record(SYSTEM, { action: 'snippet.created', details: { seeded: DEFAULT_SNIPPETS.map((t) => t.name) } });
  }

  // ---------------- presets ----------------

  listPresets(onlyIds?: number[]): PresetView[] {
    if (onlyIds && onlyIds.length === 0) return [];
    const ps = this.db
      .select()
      .from(presets)
      .where(onlyIds ? inArray(presets.id, onlyIds) : undefined)
      .orderBy(sql`lower(${presets.name})`)
      .all();
    const ids = ps.map((p) => p.id);
    const gs = ids.length ? this.db.select().from(presetGroups).where(inArray(presetGroups.presetId, ids)).all() : [];
    const acc = ids.length ? this.db.select().from(presetAccess).where(inArray(presetAccess.presetId, ids)).all() : [];
    return ps.map((p) => ({
      id: p.id,
      name: p.name,
      groups: gs
        .filter((g) => g.presetId === p.id)
        .map((g) => ({ id: g.groupId, name: g.groupName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      userIds: acc.filter((a) => a.presetId === p.id).map((a) => a.userId),
    }));
  }

  preset(id: number): PresetView {
    const p = this.listPresets([id])[0];
    if (!p) throw notFound('That preset was not found.');
    return p;
  }

  private nameTaken(name: string, exceptId?: number) {
    const row = this.db
      .select({ id: presets.id })
      .from(presets)
      .where(sql`lower(${presets.name}) = ${name.toLowerCase()}`)
      .get();
    return row && row.id !== exceptId;
  }

  createPreset(ctx: AuditContext, input: { name: string; groups: { id: string; name: string }[] }): PresetView {
    const name = input.name.trim();
    if (this.nameTaken(name)) throw conflict('A preset with that name already exists. Pick another name.');
    const now = Date.now();
    const id = this.db.transaction((tx) => {
      const p = tx.insert(presets).values({ name, createdAt: now, updatedAt: now }).returning({ id: presets.id }).get();
      const uniq = dedupe(input.groups);
      if (uniq.length) tx.insert(presetGroups).values(uniq.map((g) => ({ presetId: p.id, groupId: g.id, groupName: g.name }))).run();
      return p.id;
    });
    this.audit.record(ctx, {
      action: 'preset.created',
      targetType: 'preset',
      targetId: id,
      details: { name, groups: input.groups.length, groupNames: input.groups.map((g) => g.name).slice(0, 50) },
    });
    return this.preset(id);
  }

  updatePreset(ctx: AuditContext, id: number, input: { name: string; groups: { id: string; name: string }[] }): PresetView {
    const before = this.preset(id);
    const name = input.name.trim();
    if (this.nameTaken(name, id)) throw conflict('A preset with that name already exists. Pick another name.');
    const uniq = dedupe(input.groups);
    this.db.transaction((tx) => {
      tx.update(presets).set({ name, updatedAt: Date.now() }).where(eq(presets.id, id)).run();
      tx.delete(presetGroups).where(eq(presetGroups.presetId, id)).run();
      if (uniq.length) tx.insert(presetGroups).values(uniq.map((g) => ({ presetId: id, groupId: g.id, groupName: g.name }))).run();
    });
    const beforeIds = new Set(before.groups.map((g) => g.id));
    const afterIds = new Set(uniq.map((g) => g.id));
    const changes = {
      ...diff({ name: before.name }, { name }),
      ...(JSON.stringify([...beforeIds].sort()) !== JSON.stringify([...afterIds].sort())
        ? {
            groups: {
              added: uniq.filter((g) => !beforeIds.has(g.id)).map((g) => g.name),
              removed: before.groups.filter((g) => !afterIds.has(g.id)).map((g) => g.name),
            },
          }
        : {}),
    };
    if (Object.keys(changes).length) {
      this.audit.record(ctx, { action: 'preset.updated', targetType: 'preset', targetId: id, details: { name, changes } });
    }
    return this.preset(id);
  }

  deletePreset(ctx: AuditContext, id: number) {
    const before = this.preset(id);
    this.db.delete(presets).where(eq(presets.id, id)).run(); // preset_groups / preset_access cascade
    this.audit.record(ctx, {
      action: 'preset.deleted',
      targetType: 'preset',
      targetId: id,
      details: { name: before.name, groups: before.groups.length, usersWhoHadAccess: before.userIds },
    });
  }

  /** Users may only send to groups inside presets assigned to them. */
  allowedGroupIds(presetIds: number[]): Set<string> {
    if (!presetIds.length) return new Set();
    return new Set(
      this.db
        .select({ g: presetGroups.groupId })
        .from(presetGroups)
        .where(inArray(presetGroups.presetId, presetIds))
        .all()
        .map((r) => r.g),
    );
  }

  // ---------------- snippets ----------------

  listSnippets(): Snippet[] {
    return this.db
      .select({ id: snippets.id, name: snippets.name, body: snippets.body })
      .from(snippets)
      .orderBy(asc(snippets.sort), asc(snippets.id))
      .all();
  }

  snippet(id: number): Snippet | undefined {
    return this.listSnippets().find((t) => t.id === id);
  }

  createSnippet(ctx: AuditContext, t: { name: string; body: string }): Snippet[] {
    const sort = this.listSnippets().length;
    const row = this.db.insert(snippets).values({ ...t, sort, updatedAt: Date.now() }).returning({ id: snippets.id }).get();
    this.audit.record(ctx, { action: 'snippet.created', targetType: 'snippet', targetId: row.id, details: t });
    return this.listSnippets();
  }

  updateSnippet(ctx: AuditContext, id: number, t: { name: string; body: string }): Snippet[] {
    const before = this.snippet(id);
    if (!before) throw notFound('That snippet no longer exists.');
    const changes = diff({ name: before.name, body: before.body }, t);
    if (Object.keys(changes).length) {
      this.db.update(snippets).set({ ...t, updatedAt: Date.now() }).where(eq(snippets.id, id)).run();
      this.audit.record(ctx, { action: 'snippet.updated', targetType: 'snippet', targetId: id, details: { changes } });
    }
    return this.listSnippets();
  }

  deleteSnippet(ctx: AuditContext, id: number): Snippet[] {
    const before = this.snippet(id);
    if (!before) throw notFound('That snippet no longer exists.');
    this.db.delete(snippets).where(eq(snippets.id, id)).run();
    this.audit.record(ctx, { action: 'snippet.deleted', targetType: 'snippet', targetId: id, details: { name: before.name, body: before.body } });
    return this.listSnippets();
  }
}

function dedupe(gs: { id: string; name: string }[]) {
  const seen = new Map<string, { id: string; name: string }>();
  for (const g of gs) if (!seen.has(g.id)) seen.set(g.id, g);
  return [...seen.values()];
}
