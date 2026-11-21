/** Time-zone aware month helpers without external libraries. */

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of local midnight on the given local calendar date. */
function zonedMidnight(year: number, month1: number, day: number, tz: string): Date {
  const guess = Date.UTC(year, month1 - 1, day);
  let ts = guess - tzOffsetMs(guess, tz);
  ts = guess - tzOffsetMs(ts, tz); // second pass handles DST edges
  return new Date(ts);
}

export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'America/Toronto';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'America/Toronto';
  }
}

/** "YYYY-MM" for an instant in a time zone. */
export function monthKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimeZone(tz), year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

export function isMonthKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** [start, end) UTC instants for a "YYYY-MM" month in a time zone. */
export function monthRange(month: string, tz: string): { start: Date; end: Date } {
  const zone = safeTimeZone(tz);
  const [y, m] = month.split('-').map(Number);
  const start = zonedMidnight(y, m, 1, zone);
  const end = m === 12 ? zonedMidnight(y + 1, 1, 1, zone) : zonedMidnight(y, m + 1, 1, zone);
  return { start, end };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Parse a timestamp from Shortcuts. Prefers ISO 8601, but also accepts the default
 * Shortcuts long format ("Nov 21, 2026 at 5:32 PM") and Unix seconds/ms.
 * Returns null when unparseable.
 */
export function parseTimestamp(input: unknown): Date | null {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    const d = new Date(input < 1e12 ? input * 1000 : input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (/^\d{10,13}$/.test(s)) return parseTimestamp(Number(s));
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  d = new Date(s.replace(/\s+at\s+/i, ' ').replace(/[  ]/g, ' '));
  return Number.isNaN(d.getTime()) ? null : d;
}
