import type { NextRequest } from 'next/server';
import { fail, isUuid, json, readJson, requireUser } from '@/lib/http';
import { normalizeMerchant } from '@/lib/merchant';

export async function GET() {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { data, error } = await auth.supabase
    .from('merchant_rules')
    .select('id,keyword,category_id,source')
    .order('source', { ascending: false })
    .order('keyword');
  if (error) return fail(500, error.message);
  return json({ rules: data });
}

/** POST /api/rules { keyword, category_id } — add or overwrite a keyword rule. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const body = await readJson(req);
  const keyword = typeof body?.keyword === 'string' ? normalizeMerchant(body.keyword).slice(0, 100) : '';
  if (keyword.length < 2 || !isUuid(body?.category_id)) return fail(422, 'Keyword (2+ chars) and category are required');
  const { data, error } = await auth.supabase
    .from('merchant_rules')
    .upsert({ user_id: auth.user.id, keyword, category_id: body!.category_id, source: 'user' }, { onConflict: 'user_id,keyword' })
    .select()
    .single();
  if (error) return fail(500, error.message);
  return json({ ok: true, rule: data });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!isUuid(id)) return fail(404, 'Not found');
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { error } = await auth.supabase.from('merchant_rules').delete().eq('id', id);
  if (error) return fail(500, error.message);
  return json({ ok: true });
}
