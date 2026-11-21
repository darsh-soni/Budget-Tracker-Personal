/** Money helpers. All amounts are stored as integer cents. */

/**
 * Parse an amount coming from Shortcuts, CSV files or user input into integer cents.
 * Accepts numbers or strings like "12.34", "$12.34", "CA$1,234.50", "-4.00", "(4.00)", "12,34" (comma decimal).
 * Returns null when the value cannot be interpreted.
 */
export function parseAmountToCents(input: unknown): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/[-−]/.test(s)) negative = true;
  if (/\bCR\b/i.test(s)) negative = true; // bank statement credit marker

  // keep digits and separators only
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized: string;
  if (lastDot === -1 && lastComma === -1) {
    normalized = s;
  } else if (lastComma > lastDot) {
    // comma is the decimal separator if followed by 1–2 digits, else a thousands separator
    const decimals = s.length - lastComma - 1;
    normalized = decimals > 0 && decimals <= 2
      ? s.slice(0, lastComma).replace(/[.,]/g, '') + '.' + s.slice(lastComma + 1)
      : s.replace(/[.,]/g, '');
  } else {
    const decimals = s.length - lastDot - 1;
    normalized = decimals <= 2
      ? s.slice(0, lastDot).replace(/[.,]/g, '') + '.' + s.slice(lastDot + 1)
      : s.replace(/[.,]/g, '');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

export function formatCents(cents: number, currency = 'CAD', opts: { compact?: boolean; sign?: boolean } = {}): string {
  const value = cents / 100;
  // compact: drop cents for whole amounts and for anything ≥ 1,000 (KPI tiles, axis labels)
  const noCents = opts.compact && (Number.isInteger(value) || Math.abs(value) >= 1000);
  const fmt = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: noCents ? 0 : 2,
    maximumFractionDigits: noCents ? 0 : 2,
    signDisplay: opts.sign ? 'exceptZero' : 'auto',
  });
  return fmt.format(value);
}

/** Cents → plain decimal string for CSV ("1234.5" → "1234.50"). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
