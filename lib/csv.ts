/** Minimal RFC 4180 CSV parser / writer (handles quotes, escaped quotes, CRLF, BOM). */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function escapeField(v: unknown): string {
  if (v == null) return '';
  let s = String(v);
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(escapeField).join(',')).join('\r\n') + '\r\n';
}

/** Best-effort date parse for bank statements: ISO, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY, "Nov 3, 2026". */
export function parseStatementDate(value: string, order: 'mdy' | 'dmy' = 'mdy'): Date | null {
  const s = value.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const [mo, d] = order === 'dmy' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return mk(y, mo, d);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : mk(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function mk(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // noon UTC keeps the calendar date stable across North American time zones
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}
