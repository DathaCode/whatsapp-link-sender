import { Megaphone, Search, Users, UsersRound } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { Group } from '../types';

interface Section {
  key: string;
  title: string | null; // Community name, or null for standalone groups
  groups: Group[];
}

/** Community groups under their Community name; standalone groups in their own section. */
function sectionsOf(groups: Group[]): Section[] {
  const map = new Map<string, Section>();
  for (const g of groups) {
    const key = g.communityId ?? '__standalone';
    if (!map.has(key)) map.set(key, { key, title: g.communityId ? (g.communityName ?? 'Community') : null, groups: [] });
    map.get(key)!.groups.push(g);
  }
  const order = (g: Group) => (g.kind === 'community' ? 0 : g.kind === 'announcement' ? 1 : 2);
  const list = [...map.values()];
  for (const s of list) s.groups.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  // Communities first (alphabetically), standalone groups last.
  return list.sort((a, b) => (a.title === null ? 1 : b.title === null ? -1 : a.title.localeCompare(b.title)));
}

/** Searchable checklist of the WhatsApp groups this number is already a member of. */
export function GroupPicker({
  groups,
  selected,
  onChange,
  maxHeight = 'max-h-96',
}: {
  groups: Group[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  maxHeight?: string;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q) || (g.communityName ?? '').toLowerCase().includes(q)) : groups;
  }, [groups, query]);
  const sections = useMemo(() => sectionsOf(shown), [shown]);
  const sendable = shown.filter((g) => !g.readOnly);
  const hasCommunities = sections.some((s) => s.title !== null);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
        <Users className="mx-auto mb-2 size-6" aria-hidden />
        No groups yet. They appear once a WhatsApp number is connected. Admins can also press “Refresh groups” on the Groups & Presets page.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor={searchId} className="sr-only">
            Find a group
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id={searchId}
            type="search"
            className="field pl-9"
            placeholder={`Find among ${groups.length} groups`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-quiet flex-1 text-sm sm:flex-none"
            onClick={() => onChange(new Set([...selected, ...sendable.map((g) => g.id)]))}
            disabled={sendable.length === 0}
          >
            Select {query ? 'shown' : 'all'}
          </button>
          <button
            type="button"
            className="btn-quiet flex-1 text-sm sm:flex-none"
            onClick={() => onChange(query ? new Set([...selected].filter((id) => !shown.some((g) => g.id === id))) : new Set())}
            disabled={selected.size === 0}
          >
            Clear{query ? ' shown' : ''}
          </button>
        </div>
      </div>

      <div className={`mt-3 ${maxHeight} overflow-y-auto rounded-xl border border-line`}>
        {shown.length === 0 && <p className="p-4 text-muted">No group matches “{query}”.</p>}
        {sections.map((section) => (
          <section key={section.key} aria-label={section.title ? `Community ${section.title}` : 'Groups'}>
            {hasCommunities && (
              <h4 className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface-2 px-3.5 py-2 text-xs font-bold tracking-wide text-muted uppercase">
                {section.title ? (
                  <>
                    <UsersRound className="size-4 text-accent" aria-hidden />
                    <span className="truncate normal-case">{section.title}</span>
                    <span className="font-semibold normal-case opacity-80">· Community</span>
                  </>
                ) : (
                  'Other groups'
                )}
              </h4>
            )}
            <ul className="divide-y divide-line" role="list">
              {section.groups.map((g) => (
                <li key={g.id}>
                  <label className={`flex min-h-12 items-center gap-3 px-3.5 py-2 ${g.readOnly ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-2'}`}>
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-(--accent)"
                      checked={selected.has(g.id) && !g.readOnly}
                      disabled={g.readOnly}
                      onChange={() => toggle(g.id)}
                      aria-describedby={g.reason ? `${searchId}-${g.id}-why` : undefined}
                    />
                    {g.kind === 'announcement' && <Megaphone className={`size-4 shrink-0 ${g.readOnly ? 'text-muted' : 'text-accent'}`} aria-label="Announcements" />}
                    <span className={`min-w-0 flex-1 ${g.readOnly ? 'text-muted' : ''}`}>
                      <span className="block truncate">{g.name}</span>
                      {g.reason && (
                        <span id={`${searchId}-${g.id}-why`} className="block text-xs text-muted">
                          {g.reason}
                        </span>
                      )}
                    </span>
                    {typeof g.participants === 'number' && (
                      <span className="shrink-0 text-xs text-muted tabular-nums" title={`${g.participants} members`}>
                        {g.participants.toLocaleString()} members
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Groups (by id) that share a Community with at least one other selected group. */
export function sharedCommunityWarning(groups: Group[], selected: Set<string>): { community: string; count: number }[] {
  const byCommunity = new Map<string, { name: string; count: number }>();
  for (const g of groups) {
    if (!selected.has(g.id) || !g.communityId || g.readOnly) continue;
    const e = byCommunity.get(g.communityId) ?? { name: g.communityName ?? 'a Community', count: 0 };
    e.count++;
    byCommunity.set(g.communityId, e);
  }
  return [...byCommunity.values()].filter((e) => e.count > 1).map((e) => ({ community: e.name, count: e.count }));
}
