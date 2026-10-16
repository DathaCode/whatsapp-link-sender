import { Search, Users } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { Group } from '../types';

/** Searchable checklist of the WhatsApp groups this number is already a member of. */
export function GroupPicker({
  groups,
  selected,
  onChange,
  maxHeight = 'max-h-80',
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
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
  }, [groups, query]);
  const sendable = shown.filter((g) => !g.readOnly);

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
        No groups yet. Once WhatsApp is connected, your groups appear here. You can also press “Refresh groups” on the
        Connection tab.
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

      <ul className={`mt-3 ${maxHeight} divide-y divide-line overflow-y-auto rounded-xl border border-line`} role="list">
        {shown.length === 0 && <li className="p-4 text-muted">No group matches “{query}”.</li>}
        {shown.map((g) => (
          <li key={g.id}>
            <label
              className={`flex min-h-12 items-center gap-3 px-3.5 py-2 ${
                g.readOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-2'
              }`}
            >
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-(--accent)"
                checked={selected.has(g.id)}
                disabled={g.readOnly}
                onChange={() => toggle(g.id)}
              />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {g.readOnly && <span className="shrink-0 text-xs text-muted">Can’t post here</span>}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
