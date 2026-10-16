/**
 * Turning raw WhatsApp Web chat data into the group list the app uses.
 * Kept free of browser code so it can be unit-tested.
 *
 * WhatsApp Communities, as WhatsApp Web models them:
 *   - the Community itself is a "parent group" (isParentGroup). Nobody posts to it directly.
 *   - each Community has one "Announcements" group (defaultSubgroup). Only Community admins can post.
 *     Its subject is the Community's name, which is why several groups looked like "Hiru News".
 *   - other groups in a Community are normal groups with parentGroup = the Community id.
 */

export type GroupKind = 'group' | 'announcement' | 'community';

export const REASONS = {
  community: 'Community – choose one of its groups instead',
  notMember: 'Not a member',
  announcement: 'Announcement group – Community admins only',
  adminsOnly: 'Only admins can send',
} as const;

export interface GroupInfo {
  id: string;
  /** Display name, disambiguated (e.g. "Hiru News · Announcements"). */
  name: string;
  /** True when this number can't post here; `reason` says why. */
  readOnly: boolean;
  reason?: string | null;
  kind?: GroupKind;
  communityId?: string | null;
  communityName?: string | null;
  participants?: number | null;
}

/** What the browser reports for one chat (see WaClient.inspectChats). */
export interface RawChat {
  id: string;
  name: string | null;
  subject: string | null;
  isGroup: boolean;
  archived: boolean;
  isReadOnly: boolean;
  /** groupMetadata was available (after an optional fresh fetch from WhatsApp). */
  metaLoaded: boolean;
  metaError: string | null;
  isParentGroup: boolean;
  parentGroupId: string | null;
  parentGroupName: string | null;
  defaultSubgroup: boolean;
  hiddenSubgroup: boolean;
  announce: boolean;
  restrict: boolean;
  iAmMember: boolean | null;
  iAmAdmin: boolean | null;
  participants: number | null;
  size: number | null;
  /** Community parents only: subgroups this number has NOT joined. */
  unjoinedSubgroups: { id: string; subject: string | null }[];
  /** Every metadata attribute name WhatsApp Web exposes (for diagnosing renamed fields). */
  rawKeys: string[];
}

export interface ClassifiedGroup extends GroupInfo {
  kind: GroupKind;
  reason: string | null;
  communityId: string | null;
  communityName: string | null;
  participants: number | null;
}

export function classifyGroups(chats: RawChat[]): ClassifiedGroup[] {
  const byId = new Map(chats.map((c) => [c.id, c]));
  const nameOf = (c: RawChat) => (c.name || c.subject || c.id.split('@')[0] || c.id).trim();
  const out: ClassifiedGroup[] = [];

  for (const c of chats) {
    if (!c.isGroup) continue;
    const kind: GroupKind = c.isParentGroup ? 'community' : c.defaultSubgroup ? 'announcement' : 'group';
    const parent = c.parentGroupId ? byId.get(c.parentGroupId) : undefined;
    const communityId = kind === 'community' ? c.id : c.parentGroupId;
    const communityName = kind === 'community' ? nameOf(c) : parent ? nameOf(parent) : c.parentGroupName;
    const admin = c.iAmAdmin === true;

    let reason: string | null = null;
    if (kind === 'community') reason = REASONS.community;
    else if (c.iAmMember === false || (c.isReadOnly && !c.announce)) reason = REASONS.notMember;
    else if (kind === 'announcement' && !admin) reason = REASONS.announcement;
    else if (c.announce && !admin) reason = REASONS.adminsOnly;

    const base = nameOf(c);
    const name =
      kind === 'announcement'
        ? `${communityName ?? base} · Announcements`
        : kind === 'community'
          ? `${base} (Community)`
          : base;

    out.push({ id: c.id, name, readOnly: reason !== null, reason, kind, communityId, communityName: communityName ?? null, participants: c.participants ?? c.size });
  }

  // Subgroups of a Community that this number hasn't joined (not chats yet): list them so it's clear why they're missing.
  for (const c of chats) {
    for (const s of c.unjoinedSubgroups) {
      if (out.some((g) => g.id === s.id)) continue;
      out.push({
        id: s.id,
        name: s.subject || s.id.split('@')[0]!,
        readOnly: true,
        reason: REASONS.notMember,
        kind: 'group',
        communityId: c.id,
        communityName: nameOf(c),
        participants: null,
      });
    }
  }

  return out.sort(
    (a, b) =>
      (a.communityName ?? '￿').localeCompare(b.communityName ?? '￿') ||
      kindOrder(a.kind) - kindOrder(b.kind) ||
      a.name.localeCompare(b.name),
  );
}

const kindOrder = (k: GroupKind) => (k === 'community' ? 0 : k === 'announcement' ? 1 : 2);
