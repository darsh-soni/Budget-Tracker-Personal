import type { NextRequest } from 'next/server';
import { fail, isUuid, json, readJson, requireUser } from '@/lib/http';
import { cardFields } from '@/lib/validate';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return fail(404, 'Not found');
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const body = await readJson(req);
  if (!body) return fail(400, 'Body must be JSON');
  const { out, errors } = cardFields(body, true);
  if (errors.length) return fail(422, errors.join('. '));
  const { data, error } = await auth.supabase.from('cards').update(out).eq('id', id).select().single();
  if (error) return fail(500, error.message);
  return json({ ok: true, card: data });
}

/** Deleting a card keeps its transactions (card_id becomes null, raw name is kept). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return fail(404, 'Not found');
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { error } = await auth.supabase.from('cards').delete().eq('id', id);
  if (error) return fail(500, error.message);
  return json({ ok: true });
}
