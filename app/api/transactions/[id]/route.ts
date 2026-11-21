import type { NextRequest } from 'next/server';
import { fail, isUuid, json, readJson, requireUser } from '@/lib/http';
import { cleanText } from '@/lib/ingest';
import { merchantKey } from '@/lib/merchant';
import { parseAmountToCents } from '@/lib/money';
import { parseTimestamp } from '@/lib/dates';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/transactions/:id — edit a transaction.
 * Changing category_id teaches a merchant rule ("remember corrections"), and with
 * apply_to_similar=true re-categorises other transactions from the same merchant.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return fail(404, 'Not found');
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase, user } = auth;
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail(400, 'Body must be JSON');

  const { data: tx } = await supabase.from('transactions').select('*').eq('id', id).single();
  if (!tx) return fail(404, 'Not found');

  const patch: Record<string, unknown> = {};
  if ('amount' in body || 'amount_cents' in body) {
    const c = typeof body.amount_cents === 'number' ? Math.round(body.amount_cents) : parseAmountToCents(body.amount);
    if (!c) return fail(422, 'Invalid amount');
    patch.amount_cents = c;
  }
  if ('merchant' in body) {
    const m = cleanText(body.merchant, 200);
    if (!m) return fail(422, 'Merchant is required');
    patch.merchant = m;
    patch.merchant_key = merchantKey(m);
  }
  if ('card_id' in body) patch.card_id = isUuid(body.card_id) ? body.card_id : null;
  if ('category_id' in body) patch.category_id = isUuid(body.category_id) ? body.category_id : null;
  if ('note' in body) patch.note = cleanText(body.note, 500);
  if ('occurred_at' in body) {
    const d = parseTimestamp(body.occurred_at);
    if (!d) return fail(422, 'Invalid date');
    patch.occurred_at = d.toISOString();
  }

  const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select().single();
  if (error) return fail(500, error.message);

  let learned: string | null = null;
  let updatedSimilar = 0;
  const categoryChanged = 'category_id' in patch && patch.category_id && patch.category_id !== tx.category_id;
  if (categoryChanged) {
    const key = (data.merchant_key as string).slice(0, 100);
    if (key.length >= 2) {
      await supabase
        .from('merchant_rules')
        .upsert({ user_id: user.id, keyword: key, category_id: patch.category_id, source: 'user' }, { onConflict: 'user_id,keyword' });
      learned = key;
    }
    if (body.apply_to_similar === true) {
      const { data: similar } = await supabase
        .from('transactions')
        .update({ category_id: patch.category_id })
        .eq('user_id', user.id)
        .eq('merchant_key', data.merchant_key)
        .neq('id', id)
        .select('id');
      updatedSimilar = similar?.length ?? 0;
    }
  }
  return json({ ok: true, transaction: data, learnedRule: learned, updatedSimilar });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return fail(404, 'Not found');
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { error } = await auth.supabase.from('transactions').delete().eq('id', id);
  if (error) return fail(500, error.message);
  return json({ ok: true });
}
