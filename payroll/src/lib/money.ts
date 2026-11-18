/** All money is integer cents. These helpers are the only place dollars are parsed or printed. */

export function formatMoney(cents: number | null | undefined): string {
  const c = Number(cents ?? 0);
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** Plain decimal for CSV files: 1234.5 dollars -> "1234.50". */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse "1,234.56", "$1234.5", "1234" into cents. Returns null for anything else. */
export function parseMoney(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return neg ? -cents : cents;
}

/** Parse hours with up to two decimals. */
export function parseHours(input: string | null | undefined): number | null {
  if (input == null || String(input).trim() === '') return 0;
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

/** hours x rate in cents, rounded half-up to the cent. Works in hundredths of an hour to avoid float drift. */
export function hoursTimesRate(hours: number, rateCents: number): number {
  const hundredths = Math.round(hours * 100);
  return Math.round((hundredths * rateCents) / 100);
}
