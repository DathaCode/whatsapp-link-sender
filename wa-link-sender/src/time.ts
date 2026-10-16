/** Time helpers that always work in the configured time zone, independent of the host clock zone. */

export interface LocalTime {
  /** YYYY-MM-DD in the configured zone */
  day: string;
  /** minutes since local midnight */
  minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localTime(date: Date, tz: string): LocalTime {
  const parts = Object.fromEntries(formatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function parseHHMM(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * True when `minutes` falls inside [start, end). Windows may cross midnight,
 * e.g. 20:00-02:00.
 */
export function inWindow(minutes: number, start: string, end: string): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}
