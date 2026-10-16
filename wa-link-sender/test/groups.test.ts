import { afterEach, describe, expect, it } from 'vitest';
import { classifyGroups, REASONS, type RawChat } from '../src/groups.js';
import { harness } from './helpers.js';

const chat = (over: Partial<RawChat> & { id: string }): RawChat => ({
  name: null,
  subject: null,
  isGroup: over.id.endsWith('@g.us'),
  archived: false,
  isReadOnly: false,
  metaLoaded: true,
  metaError: null,
  isParentGroup: false,
  parentGroupId: null,
  parentGroupName: null,
  defaultSubgroup: false,
  hiddenSubgroup: false,
  announce: false,
  restrict: false,
  iAmMember: true,
  iAmAdmin: false,
  participants: 50,
  size: 50,
  unjoinedSubgroups: [],
  rawKeys: [],
  ...over,
});

// Mirrors the real case: a "Hiru News" Community with its Announcements group and numbered groups.
const hiru = [
  chat({ id: 'c1@g.us', name: 'Hiru News', isParentGroup: true, participants: 900, unjoinedSubgroups: [{ id: 'g30@g.us', subject: 'Hiru News #30' }] }),
  chat({ id: 'ann@g.us', name: 'Hiru News', defaultSubgroup: true, announce: true, parentGroupId: 'c1@g.us', participants: 900 }),
  chat({ id: 'g20@g.us', name: 'Hiru News #20', announce: true, parentGroupId: 'c1@g.us', participants: 250 }),
  chat({ id: 'g22@g.us', name: 'Hiru News #22', parentGroupId: 'c1@g.us', participants: 240 }),
  chat({ id: 'g24@g.us', name: 'Hiru News #24', announce: true, iAmAdmin: true, parentGroupId: 'c1@g.us', participants: 230 }),
  chat({ id: 'dev@g.us', name: '10th dev', participants: 5 }),
  chat({ id: 'left@g.us', name: 'Old group', iAmMember: false }),
  chat({ id: '9477@c.us', name: 'A person' }),
];

describe('classifyGroups (WhatsApp Communities)', () => {
  const out = classifyGroups(hiru);
  const byId = (id: string) => out.find((g) => g.id === id)!;

  it('skips personal chats', () => {
    expect(out.some((g) => g.id === '9477@c.us')).toBe(false);
  });

  it('marks the Community itself as not postable, with a clear name', () => {
    expect(byId('c1@g.us')).toMatchObject({ kind: 'community', readOnly: true, reason: REASONS.community, name: 'Hiru News (Community)' });
  });

  it('names the Announcements group after its Community and explains who can post', () => {
    expect(byId('ann@g.us')).toMatchObject({
      kind: 'announcement',
      name: 'Hiru News · Announcements',
      readOnly: true,
      reason: REASONS.announcement,
      communityId: 'c1@g.us',
      communityName: 'Hiru News',
      participants: 900,
    });
  });

  it('uses the real reason for admin-only groups, and allows them when we are admin', () => {
    expect(byId('g20@g.us')).toMatchObject({ readOnly: true, reason: REASONS.adminsOnly });
    expect(byId('g24@g.us')).toMatchObject({ readOnly: false, reason: null });
  });

  it('allows normal Community groups and standalone groups', () => {
    expect(byId('g22@g.us')).toMatchObject({ readOnly: false, communityName: 'Hiru News' });
    expect(byId('dev@g.us')).toMatchObject({ readOnly: false, communityId: null });
  });

  it('labels groups we are not in', () => {
    expect(byId('left@g.us')).toMatchObject({ readOnly: true, reason: REASONS.notMember });
    expect(byId('g30@g.us')).toMatchObject({ readOnly: true, reason: REASONS.notMember, communityName: 'Hiru News' });
  });

  it('becomes postable after we are made admin of the Announcements group', () => {
    const promoted = classifyGroups(hiru.map((c) => (c.id === 'ann@g.us' ? { ...c, iAmAdmin: true } : c)));
    expect(promoted.find((g) => g.id === 'ann@g.us')).toMatchObject({ readOnly: false, reason: null });
  });

  it('lists Community groups together, Community first, then Announcements', () => {
    const ids = out.filter((g) => g.communityId === 'c1@g.us').map((g) => g.id);
    expect(ids.slice(0, 2)).toEqual(['c1@g.us', 'ann@g.us']);
  });

  it('still lists groups whose metadata could not be fetched', () => {
    const r = classifyGroups([chat({ id: 'x@g.us', name: 'Slow group', metaLoaded: false, iAmMember: null, iAmAdmin: null })]);
    expect(r).toHaveLength(1);
    expect(r[0]!.readOnly).toBe(false);
  });
});

describe('group diagnostics route', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  afterEach(async () => {
    await h.close();
  });

  it('returns raw metadata compared with the saved list, and is audited', async () => {
    h = await harness();
    const admin = await h.admin();
    await h.linkConnection(admin);
    const r = await admin.post('/api/admin/groups/debug');
    expect(r.status).toBe(200);
    expect(r.body.summary.groupChats).toBe(4);
    expect(r.body.chats[0]).toHaveProperty('rawKeys');
    expect(r.body.chats.every((c: { inSavedList: boolean }) => c.inSavedList)).toBe(true);
    expect(h.actions().some((a) => a.action === 'group.debug_dumped')).toBe(true);
  });
});
