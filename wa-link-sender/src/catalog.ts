import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { diff, SYSTEM, type AuditContext, type AuditLog } from './audit.js';
import type { Db } from './db/index.js';
import { presetAccess, presetGroups, presets, templates } from './db/schema.js';
import { badRequest, conflict, notFound } from './errors.js';

export interface PresetView {
  id: number;
  name: string;
  groups: { id: string; name: string }[];
  userIds: number[];
}

export interface Template {
  id: number;
  name: string;
  body: string;
  active: boolean;
}

const DEFAULT_TEMPLATES: { name: string; body: string }[] = [
  { name: 'Just the link', body: '{url}' },
  { name: 'New post', body: 'New post is up 👇\n{url}' },
  { name: 'Please watch & share', body: 'Please watch and share 🙏\n{url}' },
  { name: 'Check this out', body: 'Check this out: {url}' },
];

/** Presets (named group lists) and message templates. */
export class Catalog {
  constructor(
    private db: Db,
    private audit: AuditLog,
  ) {}

  seedTemplates() {
    const n = this.db.select({ n: count() }).from(templates).get()?.n ?? 0;
    if (n > 0) return;
    const now = Date.now();
    this.db
      .insert(templates)
      .values(DEFAULT_TEMPLATES.map((t) => ({ ...t, active: true, updatedAt: now })))
      .run();
    this.audit.record(SYSTEM, { action: 'template.created', details: { seeded: DEFAULT_TEMPLATES.map((t) => t.name) } });
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

  // ---------------- templates ----------------

  listTemplates(): Template[] {
    return this.db.select({ id: templates.id, name: templates.name, body: templates.body, active: templates.active }).from(templates).orderBy(asc(templates.id)).all();
  }

  template(id: number): Template | undefined {
    return this.listTemplates().find((t) => t.id === id);
  }

  createTemplate(ctx: AuditContext, t: { name: string; body: string; active: boolean }): Template[] {
    const row = this.db.insert(templates).values({ ...t, updatedAt: Date.now() }).returning({ id: templates.id }).get();
    this.audit.record(ctx, { action: 'template.created', targetType: 'template', targetId: row.id, details: t });
    return this.listTemplates();
  }

  updateTemplate(ctx: AuditContext, id: number, t: { name: string; body: string; active: boolean }): Template[] {
    const before = this.template(id);
    if (!before) throw notFound('That message template no longer exists.');
    const changes = diff({ name: before.name, body: before.body, active: before.active }, t);
    if (Object.keys(changes).length) {
      this.db.update(templates).set({ ...t, updatedAt: Date.now() }).where(eq(templates.id, id)).run();
      this.audit.record(ctx, { action: 'template.updated', targetType: 'template', targetId: id, details: { changes } });
    }
    return this.listTemplates();
  }

  deleteTemplate(ctx: AuditContext, id: number): Template[] {
    const before = this.template(id);
    if (!before) throw notFound('That message template no longer exists.');
    if (this.listTemplates().length <= 1) throw badRequest('Keep at least one message template.');
    this.db.delete(templates).where(eq(templates.id, id)).run();
    this.audit.record(ctx, { action: 'template.deleted', targetType: 'template', targetId: id, details: { name: before.name } });
    return this.listTemplates();
  }
}

function dedupe(gs: { id: string; name: string }[]) {
  const seen = new Map<string, { id: string; name: string }>();
  for (const g of gs) if (!seen.has(g.id)) seen.set(g.id, g);
  return [...seen.values()];
}
