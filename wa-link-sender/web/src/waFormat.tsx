import type { ReactNode } from 'react';

/**
 * Renders message text the way WhatsApp shows it: *bold*, _italic_, ~strike~, ```monospace```
 * and highlighted links. Line breaks are kept by the caller (white-space: pre-wrap).
 * Display only: the text that is sent is never changed.
 */

const BOUNDARY_BEFORE = `(^|[\\s(\\[{"'“‘.,!?:;])`;
const BOUNDARY_AFTER = `(?=$|[\\s)\\]}"'”’.,!?:;])`;
const span = (m: string) => new RegExp(`${BOUNDARY_BEFORE}\\${m}(?=\\S)([^${m}\\n]*?\\S|\\S)\\${m}${BOUNDARY_AFTER}`);

const RULES: { re: RegExp; render: (inner: ReactNode, key: string) => ReactNode; mono?: boolean }[] = [
  { re: /```([\s\S]+?)```/, render: (c, k) => <code key={k} className="font-mono text-[0.92em]">{c}</code>, mono: true },
  { re: span('*'), render: (c, k) => <strong key={k} className="font-bold">{c}</strong> },
  { re: span('_'), render: (c, k) => <em key={k}>{c}</em> },
  { re: span('~'), render: (c, k) => <s key={k}>{c}</s> },
];

function formatPlain(text: string, keyBase: string): ReactNode[] {
  let best: { index: number; rule: (typeof RULES)[number]; m: RegExpExecArray } | null = null;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    // Index of the opening marker (skip the captured boundary character).
    const index = rule.mono ? m.index : m.index + (m[1]?.length ?? 0);
    if (!best || index < best.index) best = { index, rule, m };
  }
  if (!best) return text ? [text] : [];
  const { m, rule, index } = best;
  const inner = rule.mono ? m[1]! : m[2]!;
  const end = m.index + m[0].length;
  return [
    ...(index > 0 ? [text.slice(0, index)] : []),
    rule.render(rule.mono ? inner : formatPlain(inner, `${keyBase}i`), `${keyBase}-${index}`),
    ...formatPlain(text.slice(end), `${keyBase}r`),
  ];
}

/** `links`: the exact link strings as they appear in `text` (from the server analysis). */
export function WhatsAppText({ text, links = [] }: { text: string; links?: string[] }) {
  const out: ReactNode[] = [];
  let pos = 0;
  let n = 0;
  for (const link of links) {
    const at = text.indexOf(link, pos);
    if (at < 0) continue;
    out.push(...formatPlain(text.slice(pos, at), `t${n}`));
    out.push(
      <span key={`l${n}`} className="text-[#027eb5] underline decoration-1 underline-offset-2 dark:text-[#53bdeb]">
        {link}
      </span>,
    );
    pos = at + link.length;
    n++;
  }
  out.push(...formatPlain(text.slice(pos), `t${n}`));
  return <>{out}</>;
}
