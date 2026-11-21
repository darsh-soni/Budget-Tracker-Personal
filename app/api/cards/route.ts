import type { NextRequest } from 'next/server';
import { fail, json, readJson, requireUser } from '@/lib/http';
import { cardFields } from '@/lib/validate';
import { matchCard } from '@/lib/cards';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase, user } = auth;
  const body = await readJson(req);
  if (!body) return fail(400, 'Body must be JSON');
  const { out, errors } = cardFields(body, false);
  if (errors.length) return fail(422, errors.join('. '));

  const { count } = await supabase.from('cards').select('id', { count: 'exact', head: true });
  const { data, error } = await supabase
    .from('cards')
    .insert({ ...out, user_id: user.id, sort: count ?? 0 })
    .select()
    .single();
  if (error) return fail(500, error.message);

  // Attach any earlier wallet transactions whose raw card name now matches this card
  const { data: orphans } = await supabase.from('transactions').select('id,raw_card').is('card_id', null).not('raw_card', 'is', null);
  const ids = (orphans ?? []).filter((t) => matchCard(t.raw_card, [data], []) === data.id).map((t) => t.id);
  if (ids.length) await supabase.from('transactions').update({ card_id: data.id }).in('id', ids);

  return json({ ok: true, card: data, attached: ids.length }, 201);
}
