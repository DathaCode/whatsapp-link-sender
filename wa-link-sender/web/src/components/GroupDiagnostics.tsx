import { Download, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api';
import { Dialog } from './Dialog';
import { Badge } from './StatusBadge';

interface DebugChat {
  id: string;
  name: string | null;
  subject: string | null;
  shownAs: string | null;
  kind: string | null;
  canPost: boolean;
  reason: string | null;
  inSavedList: boolean;
  metaLoaded: boolean;
  metaError: string | null;
  isParentGroup: boolean;
  parentGroupId: string | null;
  parentGroupName: string | null;
  defaultSubgroup: boolean;
  hiddenSubgroup: boolean;
  announce: boolean;
  iAmMember: boolean | null;
  iAmAdmin: boolean | null;
  participants: number | null;
  archived: boolean;
  rawKeys: string[];
}
interface DebugResult {
  summary: Record<string, number>;
  chats: DebugChat[];
  others: number;
  unjoined: { id: string; name: string; communityName: string | null; reason: string | null }[];
}

const SUMMARY_LABELS: Record<string, string> = {
  groupChats: 'Group chats',
  communities: 'Communities',
  announcementGroups: 'Announcement groups',
  canPost: 'Can post',
  metadataMissing: 'Metadata missing',
  fetchErrors: 'Fetch errors',
  unjoinedSubgroups: 'Not joined (in Communities)',
  savedListDiffers: 'Not in saved list',
};

const yn = (v: boolean | null) => (v === null ? '?' : v ? 'yes' : 'no');

/** Admin tool: raw WhatsApp metadata for every group, next to what the app shows. Also written to the server log. */
export function GroupDiagnostics({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<DebugResult | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      setData(await api<DebugResult>('/api/admin/groups/debug', { body: {} }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `group-diagnostics-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <button type="button" className="btn-quiet" onClick={run} disabled={busy || disabled} title="Compare WhatsApp's raw group data with the list shown here">
        <Stethoscope className="size-4" aria-hidden />
        {busy ? 'Checking all groups…' : 'Diagnose group list'}
      </button>
      <Dialog open={!!data} title="Group list diagnostics" onClose={() => setData(null)} xl>
        {data && (
          <div className="space-y-4">
            <p className="hint">
              Fresh data from WhatsApp for every group chat ({data.others} personal chats not shown). Each row is also written to the server log
              (<code>docker compose logs app</code>, look for <code>group debug</code>).
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(SUMMARY_LABELS).map(([k, label]) => (
                <Badge key={k} tone={(k === 'fetchErrors' || k === 'metadataMissing' || k === 'savedListDiffers') && data.summary[k] ? 'warn' : 'neutral'}>
                  {label}: {data.summary[k] ?? 0}
                </Badge>
              ))}
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface-2 text-xs text-muted uppercase">
                  <tr>
                    {['Shown as', 'WhatsApp name', 'Type', 'Community', 'Member', 'Admin', 'Admins-only', 'Members', 'Can post', 'In list', 'Notes'].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.chats.map((c) => (
                    <tr key={c.id} className={c.canPost ? '' : 'bg-surface-2/40'}>
                      <td className="px-3 py-2 font-semibold">{c.shownAs ?? '–'}</td>
                      <td className="px-3 py-2">{c.name ?? c.subject ?? '–'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{c.isParentGroup ? 'Community' : c.defaultSubgroup ? 'Announcements' : 'Group'}</td>
                      <td className="px-3 py-2">{c.parentGroupName ?? (c.parentGroupId ? c.parentGroupId : '–')}</td>
                      <td className="px-3 py-2">{yn(c.iAmMember)}</td>
                      <td className="px-3 py-2">{yn(c.iAmAdmin)}</td>
                      <td className="px-3 py-2">{c.announce ? 'yes' : 'no'}</td>
                      <td className="px-3 py-2 tabular-nums">{c.participants ?? '?'}</td>
                      <td className="px-3 py-2">{c.canPost ? <Badge tone="ok">yes</Badge> : <span className="text-muted">{c.reason ?? 'no'}</span>}</td>
                      <td className="px-3 py-2">{c.inSavedList ? 'yes' : <Badge tone="warn">no</Badge>}</td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {[!c.metaLoaded && 'no metadata', c.metaError && `fetch error: ${c.metaError}`, c.archived && 'archived', c.hiddenSubgroup && 'hidden subgroup']
                          .filter(Boolean)
                          .join(' · ') || '–'}
                      </td>
                    </tr>
                  ))}
                  {data.unjoined.map((u) => (
                    <tr key={u.id} className="bg-surface-2/40">
                      <td className="px-3 py-2 font-semibold">{u.name}</td>
                      <td className="px-3 py-2">–</td>
                      <td className="px-3 py-2">Group</td>
                      <td className="px-3 py-2">{u.communityName ?? '–'}</td>
                      <td className="px-3 py-2">no</td>
                      <td className="px-3 py-2">–</td>
                      <td className="px-3 py-2">–</td>
                      <td className="px-3 py-2">?</td>
                      <td className="px-3 py-2 text-muted">{u.reason}</td>
                      <td className="px-3 py-2">–</td>
                      <td className="px-3 py-2 text-xs text-muted">listed by its Community; not joined</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-quiet" onClick={download}>
                <Download className="size-4" aria-hidden /> Download raw data (JSON)
              </button>
              <button type="button" className="btn-primary" onClick={() => setData(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
