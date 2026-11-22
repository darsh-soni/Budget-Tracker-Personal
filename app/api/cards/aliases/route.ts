import type { NextRequest } from 'next/server';
import { fail, isUuid, json, readJson, requireUser } from '@/lib/http';
import { cleanText } from '@/lib/ingest';

/**
 * POST /api/cards/aliases { alias, card_id }
 * Maps an unknown Shortcut card name to a saved card once, and back-fills past transactions.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase, user } = auth;
  const body = await readJson(req);
  const alias = cleanText(body?.alias, 100);
  if (!alias || !isUuid(body?.card_id)) return fail(422, 'alias and card_id are required');

  const { data: card } = await supabase.from('cards').select('id').eq('id', body!.card_id as string).single();
  if (!card) return fail(404, 'Card not found');

  await supabase.from('card_aliases').delete().eq('user_id', user.id).ilike('alias', alias.replace(/[%_\\]/g, (m) => '\\' + m));
  const { error } = await supabase.from('card_aliases').insert({ user_id: user.id, alias, card_id: card.id });
  if (error) return fail(500, error.message);

  const { data: updated } = await supabase
    .from('transactions')
    .update({ card_id: card.id })
    .is('card_id', null)
    .ilike('raw_card', alias.replace(/[%_\\]/g, (m) => '\\' + m))
    .select('id');
  return json({ ok: true, updated: updated?.length ?? 0 });
}
