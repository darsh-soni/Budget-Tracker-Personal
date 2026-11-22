import type { NextRequest } from 'next/server';
import { fail, json, requireUser } from '@/lib/http';
import { isMonthKey, monthKey, monthRange, safeTimeZone } from '@/lib/dates';
import type { Bootstrap } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** GET /api/bootstrap?month=YYYY-MM — everything the dashboard needs in one round trip. */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase, user } = auth;

  const { data: profile, error: pErr } = await supabase
    .from('users')
    .select('id,email,display_name,currency,timezone,api_token,last_wallet_at')
    .eq('id', user.id)
    .single();
  if (pErr || !profile) return fail(500, 'Profile missing — did the database migration run?');

  const tz = safeTimeZone(profile.timezone);
  const qMonth = req.nextUrl.searchParams.get('month');
  const month = isMonthKey(qMonth) ? qMonth : monthKey(new Date(), tz);
  const { start, end } = monthRange(month, tz);

  const [cards, categories, budgets, txs, unmatched, passkeys] = await Promise.all([
    supabase.from('cards').select('id,name,last4,color,type,monthly_limit_cents,sort,archived').order('sort').order('created_at'),
    supabase.from('categories').select('id,name,icon,color,sort,is_fallback').order('sort').order('name'),
    supabase.from('budgets').select('category_id,amount_cents'),
    supabase
      .from('transactions')
      .select('*')
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', end.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(2000),
    supabase.from('transactions').select('raw_card').is('card_id', null).not('raw_card', 'is', null).limit(1000),
    supabase.from('passkeys').select('id', { count: 'exact', head: true }),
  ]);

  const counts = new Map<string, { raw_card: string; count: number }>();
  for (const r of unmatched.data ?? []) {
    const k = (r.raw_card as string).toLowerCase();
    const e = counts.get(k) ?? { raw_card: r.raw_card as string, count: 0 };
    e.count++;
    counts.set(k, e);
  }

  const payload: Bootstrap = {
    user: profile,
    month,
    cards: cards.data ?? [],
    categories: categories.data ?? [],
    budgets: budgets.data ?? [],
    transactions: txs.data ?? [],
    unknownCards: [...counts.values()].sort((a, b) => b.count - a.count),
    passkeyCount: passkeys.count ?? 0,
  };
  return json(payload);
}
