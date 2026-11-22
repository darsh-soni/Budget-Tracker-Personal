import type { NextRequest } from 'next/server';
import { fail, isUuid, json, readJson, requireUser } from '@/lib/http';
import { parseAmountToCents } from '@/lib/money';

/** PUT /api/budgets { budgets: [{ category_id, amount }] } — monthly budget per category. */
export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase, user } = auth;
  const body = await readJson<{ budgets?: { category_id: string; amount: unknown }[] }>(req);
  if (!Array.isArray(body?.budgets)) return fail(422, 'budgets array required');
  const rows = [];
  for (const b of body.budgets) {
    const cents = b.amount === '' || b.amount == null ? 0 : parseAmountToCents(b.amount);
    if (!isUuid(b.category_id) || cents === null || cents < 0) return fail(422, 'Invalid budget amount');
    rows.push({ user_id: user.id, category_id: b.category_id, amount_cents: cents, updated_at: new Date().toISOString() });
  }
  const { error } = await supabase.from('budgets').upsert(rows, { onConflict: 'category_id' });
  if (error) return fail(500, error.message);
  return json({ ok: true });
}
