import type { NextRequest } from 'next/server';
import { fail, isUuid, json, readJson, requireUser } from '@/lib/http';
import { cleanText, loadMatchContext, resolveTransaction } from '@/lib/ingest';
import { parseTimestamp } from '@/lib/dates';

export const maxDuration = 60;

interface Row { date: string; merchant: string; amount_cents: number; card_id?: string | null }

const DAY = 86_400_000;

function similarMerchant(a: string, b: string) {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const fa = a.split(' ')[0];
  return fa.length >= 3 && fa === b.split(' ')[0];
}

/**
 * POST /api/import { rows: Row[], card_id?: string, dry_run?: boolean }
 * Rows are already mapped client-side. Skips rows that look like transactions we already
 * have (e.g. captured by Apple Wallet): same card + amount within ±3 days and a similar merchant.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase, user } = auth;
  const body = await readJson<{ rows?: Row[]; card_id?: string; dry_run?: boolean }>(req);
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return fail(422, 'No rows to import');
  if (body.rows.length > 5000) return fail(413, 'Import at most 5,000 rows at a time');

  const defaultCard = isUuid(body.card_id) ? body.card_id : null;
  const ctx = await loadMatchContext(supabase, user.id);
  const { data: profile } = await supabase.from('users').select('currency').eq('id', user.id).single();

  const parsed: Record<string, unknown>[] = [];
  const invalid: number[] = [];
  body.rows.forEach((r, i) => {
    const date = parseTimestamp(r.date);
    const merchant = cleanText(r.merchant, 200);
    const cents = Number.isInteger(r.amount_cents) ? r.amount_cents : null;
    if (!date || !merchant || !cents) { invalid.push(i); return; }
    const resolved = resolveTransaction(ctx, { merchant, cardId: isUuid(r.card_id) ? r.card_id : defaultCard });
    parsed.push({
      user_id: user.id,
      amount_cents: cents,
      currency: profile?.currency ?? 'CAD',
      merchant,
      merchant_key: resolved.merchant_key,
      card_id: resolved.card_id,
      category_id: resolved.category_id,
      occurred_at: date.toISOString(),
      source: 'import',
    });
  });
  if (!parsed.length) return fail(422, 'No valid rows — check the column mapping', { invalid: invalid.length });

  const times = parsed.map((p) => new Date(p.occurred_at as string).getTime());
  const { data: existing } = await supabase
    .from('transactions')
    .select('amount_cents,merchant_key,card_id,occurred_at')
    .gte('occurred_at', new Date(Math.min(...times) - 3 * DAY).toISOString())
    .lte('occurred_at', new Date(Math.max(...times) + 3 * DAY).toISOString())
    .limit(20000);

  const pool = (existing ?? []).map((e) => ({ ...e, t: new Date(e.occurred_at).getTime(), used: false }));
  const toInsert: Record<string, unknown>[] = [];
  let duplicates = 0;
  for (const p of parsed) {
    const t = new Date(p.occurred_at as string).getTime();
    const match = pool.find(
      (e) =>
        !e.used &&
        Number(e.amount_cents) === p.amount_cents &&
        (!p.card_id || !e.card_id || e.card_id === p.card_id) &&
        Math.abs(e.t - t) <= 3 * DAY &&
        similarMerchant(e.merchant_key, p.merchant_key as string),
    );
    if (match) { match.used = true; duplicates++; continue; }
    toInsert.push(p);
  }

  if (body.dry_run) return json({ ok: true, dry_run: true, wouldImport: toInsert.length, duplicates, invalid: invalid.length });

  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await supabase.from('transactions').insert(toInsert.slice(i, i + 500));
    if (error) return fail(500, error.message, { imported: i });
  }
  return json({ ok: true, imported: toInsert.length, duplicates, invalid: invalid.length });
}
