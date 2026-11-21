'use client';
import { useMemo, useState } from 'react';
import { useBootstrap, refreshAll } from '@/lib/client/data';
import { api } from '@/lib/client/api';
import { formatCents } from '@/lib/client/format';
import { parseCsv, parseStatementDate } from '@/lib/csv';
import { parseAmountToCents } from '@/lib/money';
import { BackLink } from '@/components/BackLink';
import { Switch } from '@/components/Switch';
import { useShell } from '@/components/AppShell';

type AmountMode = 'single' | 'split';
interface Mapping { date: number; merchant: number; amount: number; debit: number; credit: number }

const find = (headers: string[], ...patterns: RegExp[]) => {
  for (const re of patterns) {
    const i = headers.findIndex((h) => re.test(h.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
};

export default function ImportPage() {
  const { data } = useBootstrap();
  const { toast } = useShell();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState<Mapping>({ date: -1, merchant: -1, amount: -1, debit: -1, credit: -1 });
  const [mode, setMode] = useState<AmountMode>('single');
  const [negativeIsExpense, setNegativeIsExpense] = useState(false);
  const [dateOrder, setDateOrder] = useState<'mdy' | 'dmy'>('mdy');
  const [cardId, setCardId] = useState<string>('');
  const [preview, setPreview] = useState<{ wouldImport: number; duplicates: number; invalid: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    const parsed = parseCsv(text);
    if (!parsed.length) return toast('That file has no rows');
    setFileName(f.name);
    setRows(parsed);
    setPreview(null);
    const first = parsed[0];
    const looksLikeHeader = first.every((c) => !/^\s*-?[$]?\d[\d,.]*\s*$/.test(c)) && !first.some((c) => parseStatementDate(c) && /\d/.test(c) && c.length <= 12);
    setHasHeader(looksLikeHeader);
    const h = looksLikeHeader ? first : first.map(() => '');
    const debit = find(h, /debit|withdraw|money out/);
    const credit = find(h, /credit|deposit|money in/);
    const amount = find(h, /^amount|amount|cad\$|value/);
    const next: Mapping = {
      date: find(h, /^date$|transaction date|posted|date/) ,
      merchant: find(h, /description|merchant|payee|name|details|memo/),
      amount,
      debit,
      credit,
    };
    if (!looksLikeHeader) {
      // headerless (e.g. TD/RBC): guess date=0, description=1, numbers afterwards
      next.date = 0; next.merchant = 1; next.amount = first.length > 2 ? 2 : -1;
      next.debit = first.length > 3 ? 2 : -1; next.credit = first.length > 3 ? 3 : -1;
    }
    setMap(next);
    setMode(amount < 0 && debit >= 0 ? 'split' : first.length >= 4 && !looksLikeHeader ? 'split' : 'single');
    // Detect DD/MM: any first-part > 12
    const di = next.date >= 0 ? next.date : 0;
    const sample = parsed.slice(looksLikeHeader ? 1 : 0, 50).map((r) => r[di] ?? '');
    setDateOrder(sample.some((s) => { const m = s.match(/^(\d{1,2})[/.-]/); return m && +m[1] > 12; }) ? 'dmy' : 'mdy');
  }

  const header = hasHeader ? rows[0] ?? [] : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;

  const mapped = useMemo(() => body.map((r) => {
    const date = map.date >= 0 ? parseStatementDate(r[map.date] ?? '', dateOrder) : null;
    const merchant = map.merchant >= 0 ? (r[map.merchant] ?? '').trim() : '';
    let cents: number | null = null;
    if (mode === 'single' && map.amount >= 0) {
      const v = parseAmountToCents(r[map.amount] ?? '');
      cents = v === null ? null : negativeIsExpense ? -v : v;
    } else if (mode === 'split') {
      const d = map.debit >= 0 ? parseAmountToCents(r[map.debit] ?? '') : null;
      const c = map.credit >= 0 ? parseAmountToCents(r[map.credit] ?? '') : null;
      cents = d ? Math.abs(d) : c ? -Math.abs(c) : null;
    }
    return { date, merchant, cents };
  }), [body, map, mode, negativeIsExpense, dateOrder]);

  const valid = mapped.filter((m) => m.date && m.merchant && m.cents);
  const payload = () => valid.map((m) => ({ date: m.date!.toISOString(), merchant: m.merchant, amount_cents: m.cents! }));

  async function run(dry: boolean) {
    setBusy(true);
    try {
      const r = await api<{ wouldImport?: number; imported?: number; duplicates: number; invalid: number }>('/api/import', {
        body: { rows: payload(), card_id: cardId || null, dry_run: dry },
      });
      if (dry) setPreview({ wouldImport: r.wouldImport ?? 0, duplicates: r.duplicates, invalid: r.invalid });
      else {
        toast(`Imported ${r.imported} · skipped ${r.duplicates} already logged`);
        setRows([]); setFileName(''); setPreview(null);
        refreshAll();
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const select = (label: string, key: keyof Mapping) => (
    <label className="field field-label">
      <span>{label}</span>
      <select className="text" value={map[key]} onChange={(e) => { setMap({ ...map, [key]: Number(e.target.value) }); setPreview(null); }}>
        <option value={-1}>—</option>
        {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}{body[0]?.[i] ? ` (e.g. ${body[0][i].slice(0, 24)})` : ''}</option>)}
      </select>
    </label>
  );

  return (
    <div className="page">
      <BackLink />
      <h1 className="large-title">Import CSV</h1>
      <p className="muted" style={{ margin: '0 4px 12px' }}>
        Catch purchases Apple Pay didn’t see. Download a CSV from your bank’s website, then pick it here. Rows already logged from Wallet are skipped.
      </p>

      <label className="btn secondary" style={{ cursor: 'pointer' }}>
        {fileName ? `📄 ${fileName}` : 'Choose CSV file'}
        <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {rows.length > 0 && (
        <>
          <div className="section-title">Columns</div>
          <div className="group">
            <div className="cell"><span className="label">First row is a header</span><Switch checked={hasHeader} onChange={setHasHeader} label="First row is a header" /></div>
            {select('Date', 'date')}
            {select('Merchant', 'merchant')}
          </div>

          <div className="section-title">Amount</div>
          <div className="segmented">
            <button aria-pressed={mode === 'single'} onClick={() => setMode('single')}>One column</button>
            <button aria-pressed={mode === 'split'} onClick={() => setMode('split')}>Debit / Credit</button>
          </div>
          <div className="group" style={{ marginTop: 8 }}>
            {mode === 'single' ? (
              <>
                {select('Amount', 'amount')}
                <div className="cell"><span className="label">Expenses are negative</span><Switch checked={negativeIsExpense} onChange={setNegativeIsExpense} label="Expenses are negative numbers" /></div>
              </>
            ) : (
              <>{select('Debit', 'debit')}{select('Credit', 'credit')}</>
            )}
          </div>

          <div className="section-title">Options</div>
          <div className="group">
            <label className="field field-label">
              <span>Dates</span>
              <select className="text" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as 'mdy' | 'dmy')}>
                <option value="mdy">MM/DD/YYYY</option>
                <option value="dmy">DD/MM/YYYY</option>
              </select>
            </label>
            <label className="field field-label">
              <span>Card</span>
              <select className="text" value={cardId} onChange={(e) => setCardId(e.target.value)}>
                <option value="">None</option>
                {data?.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <div className="section-title">Preview · {valid.length} of {body.length} rows readable</div>
          <div className="group">
            {mapped.slice(0, 6).map((m, i) => (
              <div key={i} className="cell" style={{ opacity: m.date && m.merchant && m.cents ? 1 : 0.45 }}>
                <span className="faint tabular" style={{ width: 84, fontSize: 14 }}>{m.date ? m.date.toISOString().slice(0, 10) : '??'}</span>
                <span className="label ellipsis">{m.merchant || '—'}</span>
                <span className={`tx-amount${(m.cents ?? 0) < 0 ? ' refund' : ''}`}>{m.cents ? formatCents(m.cents, data?.user.currency) : '—'}</span>
              </div>
            ))}
          </div>
          <p className="footnote">Positive amounts are spending; negative amounts are refunds/payments. Check the preview signs look right.</p>

          {preview && (
            <div className="banner info" style={{ marginTop: 12 }}>
              <span>
                <strong>{preview.wouldImport}</strong> new · {preview.duplicates} already logged · {preview.invalid} unreadable
              </span>
            </div>
          )}
          <div className="row-gap" style={{ marginTop: 16, flexWrap: 'nowrap' }}>
            <button className="btn secondary" disabled={busy || !valid.length} onClick={() => run(true)}>Check</button>
            <button className="btn" disabled={busy || !valid.length} onClick={() => run(false)}>{busy ? 'Working…' : `Import ${valid.length}`}</button>
          </div>
        </>
      )}
    </div>
  );
}
