import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fail, isUuid, json, readJson, requireUser } from '@/lib/http';
import { cleanText, loadMatchContext, resolveTransaction } from '@/lib/ingest';
import { parseAmountToCents } from '@/lib/money';
import { parseTimestamp } from '@/lib/dates';
import { checkBudgetAlerts } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

const MAX_CENTS = 10_000_000_00; // $10M sanity cap

/** Lower-case all top-level keys so "Amount" / "amount" both work from Shortcuts. */
function lowerKeys(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k.toLowerCase(), v]));
}

function tokenFrom(req: NextRequest): string | null {
  const key = req.headers.get('x-api-key');
  if (key) return key.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

/**
 * POST /api/transactions
 *  • With X-Api-Key: Apple Wallet capture from the iOS Shortcut.
 *    Body { amount, merchant, card, timestamp?, note?, test? }
 *  • With a session cookie: manual entry from the app.
 *    Body { amount | amount_cents, merchant, card_id?, category_id?, occurred_at?, note?, client_id? }
 */
export async function POST(req: NextRequest) {
  const token = tokenFrom(req);
  return token !== null ? walletCapture(req, token) : manualEntry(req);
}

async function walletCapture(req: NextRequest, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return fail(401, 'Invalid API key');
  const db = supabaseAdmin();
  const { data: user } = await db.from('users').select('id,currency').eq('api_token', token).maybeSingle();
  if (!user) return fail(401, 'Invalid API key');

  const raw = await readJson<Record<string, unknown>>(req);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Body must be a JSON object');
  const body = lowerKeys(raw);

  const amount_cents = parseAmountToCents(body.amount);
  if (amount_cents === null || amount_cents === 0 || Math.abs(amount_cents) > MAX_CENTS)
    return fail(422, 'amount is missing or not a number', { received: body.amount ?? null });
  const merchant = cleanText(body.merchant, 200);
  if (!merchant) return fail(422, 'merchant is required');
  const rawCard = cleanText(body.card ?? body['card or pass'], 100);
  const note = cleanText(body.note, 500);
  const parsedTime = parseTimestamp(body.timestamp);
  // Ignore clearly wrong clocks (more than a day in the future)
  const occurredAt = parsedTime && parsedTime.getTime() < Date.now() + 86_400_000 ? parsedTime : new Date();

  const ctx = await loadMatchContext(db, user.id);
  const resolved = resolveTransaction(ctx, { merchant, rawCard });

  if (body.test === true || body.test === 'true') {
    return json({
      ok: true,
      test: true,
      message: 'Token accepted. Nothing was saved.',
      parsed: { amount_cents, merchant, card: rawCard, card_matched: !!resolved.card_id, category_id: resolved.category_id, occurred_at: occurredAt.toISOString() },
    });
  }

  const { data, error } = await db.rpc('insert_transaction_dedupe', {
    p_user_id: user.id,
    p_amount_cents: amount_cents,
    p_currency: user.currency,
    p_merchant: merchant,
    p_merchant_key: resolved.merchant_key,
    p_card_id: resolved.card_id,
    p_raw_card: rawCard,
    p_category_id: resolved.category_id,
    p_occurred_at: occurredAt.toISOString(),
    p_note: note,
    p_source: 'wallet',
    p_window_seconds: 60,
  });
  if (error) {
    console.error('wallet insert failed', error.message);
    return fail(500, 'Could not save transaction');
  }
  const result = data as { duplicate: boolean; id: string };
  if (result.duplicate) return json({ ok: false, duplicate: true, id: result.id, error: 'Duplicate transaction ignored' }, 409);

  await db.from('users').update({ last_wallet_at: new Date().toISOString() }).eq('id', user.id);
  await checkBudgetAlerts(user.id, { categoryId: resolved.category_id, cardId: resolved.card_id, occurredAt }).catch((e) =>
    console.error('alert check failed', e),
  );
  return json({ ok: true, id: result.id, card_matched: !!resolved.card_id }, 201);
}

async function manualEntry(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return fail(401, 'Missing X-Api-Key header or session');
  const { user, supabase } = auth;
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail(400, 'Body must be JSON');

  const amount_cents =
    typeof body.amount_cents === 'number' && Number.isInteger(body.amount_cents) ? body.amount_cents : parseAmountToCents(body.amount);
  if (amount_cents === null || amount_cents === 0 || Math.abs(amount_cents) > MAX_CENTS) return fail(422, 'Enter an amount');
  const merchant = cleanText(body.merchant, 200);
  if (!merchant) return fail(422, 'Enter a merchant');
  const occurredAt = parseTimestamp(body.occurred_at) ?? new Date();
  const client_id = isUuid(body.client_id) ? body.client_id : null;

  const { data: profile } = await supabase.from('users').select('currency').eq('id', user.id).single();
  const ctx = await loadMatchContext(supabase, user.id);
  const resolved = resolveTransaction(ctx, {
    merchant,
    cardId: isUuid(body.card_id) ? body.card_id : null,
    categoryId: isUuid(body.category_id) ? body.category_id : null,
  });

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      amount_cents,
      currency: profile?.currency ?? 'CAD',
      merchant,
      merchant_key: resolved.merchant_key,
      card_id: resolved.card_id,
      category_id: resolved.category_id,
      occurred_at: occurredAt.toISOString(),
      note: cleanText(body.note, 500),
      source: 'manual',
      client_id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505' && client_id) {
      // replayed offline entry: return the row we already have
      const { data: existing } = await supabase.from('transactions').select().eq('client_id', client_id).single();
      return json({ ok: true, transaction: existing, replay: true });
    }
    return fail(500, error.message);
  }
  await checkBudgetAlerts(user.id, { categoryId: resolved.category_id, cardId: resolved.card_id, occurredAt }).catch(() => {});
  return json({ ok: true, transaction: data }, 201);
}

/** GET /api/transactions — search & filter (session only). */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase, user } = auth;
  const p = req.nextUrl.searchParams;
  const limit = Math.min(Number(p.get('limit')) || 50, 200);

  let q = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  const search = p.get('q')?.trim();
  if (search) q = q.ilike('merchant', `%${search.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
  const card = p.get('card');
  if (card === 'none') q = q.is('card_id', null);
  else if (isUuid(card)) q = q.eq('card_id', card);
  const category = p.get('category');
  if (category === 'none') q = q.is('category_id', null);
  else if (isUuid(category)) q = q.eq('category_id', category);
  const from = parseTimestamp(p.get('from'));
  if (from) q = q.gte('occurred_at', from.toISOString());
  const to = parseTimestamp(p.get('to'));
  if (to) q = q.lt('occurred_at', to.toISOString());
  const before = parseTimestamp(p.get('before'));
  if (before) q = q.lt('occurred_at', before.toISOString());

  const { data, error } = await q;
  if (error) return fail(500, error.message);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return json({ transactions: page, nextBefore: hasMore ? page[page.length - 1].occurred_at : null });
}
