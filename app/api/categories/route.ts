import type { NextRequest } from 'next/server';
import { fail, isUuid, json, readJson, requireUser } from '@/lib/http';
import { cleanText } from '@/lib/ingest';
import { parseAmountToCents } from '@/lib/money';

/** POST /api/categories { name, icon?, color?, budget? } */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase, user } = auth;
  const body = await readJson(req);
  const name = cleanText(body?.name, 40);
  if (!name) return fail(422, 'Name is required');
  const color = typeof body?.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#2a78d6';
  const icon = cleanText(body?.icon, 8) ?? '•';
  const { count } = await supabase.from('categories').select('id', { count: 'exact', head: true });
  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: user.id, name, icon, color, sort: (count ?? 0) + 1 })
    .select()
    .single();
  if (error) return fail(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'Category already exists' : error.message);
  const cents = parseAmountToCents(body?.budget) ?? 0;
  await supabase.from('budgets').insert({ user_id: user.id, category_id: data.id, amount_cents: Math.max(0, cents) });
  return json({ ok: true, category: data }, 201);
}

/** DELETE /api/categories?id= — transactions become uncategorised; the fallback category can't be deleted. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!isUuid(id)) return fail(404, 'Not found');
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { data: cat } = await auth.supabase.from('categories').select('is_fallback').eq('id', id).single();
  if (!cat) return fail(404, 'Not found');
  if (cat.is_fallback) return fail(422, 'The fallback category cannot be deleted');
  const { error } = await auth.supabase.from('categories').delete().eq('id', id);
  if (error) return fail(500, error.message);
  return json({ ok: true });
}
