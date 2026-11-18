/** Pay schedule math. Dates are plain 'YYYY-MM-DD' strings handled in UTC to avoid timezone drift. */

export type Schedule = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export const SCHEDULES: { value: Schedule; label: string; periodsPerYear: number }[] = [
  { value: 'weekly', label: 'Weekly', periodsPerYear: 52 },
  { value: 'biweekly', label: 'Every two weeks (biweekly)', periodsPerYear: 26 },
  { value: 'semimonthly', label: 'Twice a month (semimonthly)', periodsPerYear: 24 },
  { value: 'monthly', label: 'Monthly', periodsPerYear: 12 },
];

export function periodsPerYear(s: Schedule): number {
  return SCHEDULES.find((x) => x.value === s)!.periodsPerYear;
}

export function scheduleLabel(s: string): string {
  return SCHEDULES.find((x) => x.value === s)?.label ?? s;
}

const DAY = 86_400_000;

export function toDate(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}
export function fmtISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: string, n: number): string {
  return fmtISO(new Date(toDate(d).getTime() + n * DAY));
}
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

export type Period = { start: string; end: string; payDate: string };

/** The pay period that contains `date`. */
export function periodContaining(
  schedule: Schedule,
  date: string,
  anchorStart: string,
  paydayOffsetDays: number,
): Period {
  let start: string;
  let end: string;
  if (schedule === 'weekly' || schedule === 'biweekly') {
    const len = schedule === 'weekly' ? 7 : 14;
    const diff = daysBetween(anchorStart, date);
    const idx = Math.floor(diff / len);
    start = addDays(anchorStart, idx * len);
    end = addDays(start, len - 1);
  } else {
    const d = toDate(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const last = lastDayOfMonth(y, m);
    if (schedule === 'monthly') {
      start = fmtISO(new Date(Date.UTC(y, m, 1)));
      end = fmtISO(new Date(Date.UTC(y, m, last)));
    } else if (d.getUTCDate() <= 15) {
      start = fmtISO(new Date(Date.UTC(y, m, 1)));
      end = fmtISO(new Date(Date.UTC(y, m, 15)));
    } else {
      start = fmtISO(new Date(Date.UTC(y, m, 16)));
      end = fmtISO(new Date(Date.UTC(y, m, last)));
    }
  }
  return { start, end, payDate: addDays(end, paydayOffsetDays) };
}

export function nextPeriod(schedule: Schedule, p: Period, anchorStart: string, offset: number): Period {
  return periodContaining(schedule, addDays(p.end, 1), anchorStart, offset);
}
export function previousPeriod(schedule: Schedule, p: Period, anchorStart: string, offset: number): Period {
  return periodContaining(schedule, addDays(p.start, -1), anchorStart, offset);
}

/** The soonest pay date on or after `today` (the previous period may still be waiting to be paid). */
export function nextPayday(schedule: Schedule, today: string, anchorStart: string, offset: number): Period {
  let p = previousPeriod(schedule, periodContaining(schedule, today, anchorStart, offset), anchorStart, offset);
  while (p.payDate < today) p = nextPeriod(schedule, p, anchorStart, offset);
  return p;
}

export function todayISO(): string {
  // Payroll dates follow Central Time (Decatur, Alabama).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return '';
  return toDate(d.slice(0, 10)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fmtISO(toDate(s)) === s;
}
