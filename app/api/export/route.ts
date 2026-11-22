import type { NextRequest } from 'next/server';
import { fail, requireUser } from '@/lib/http';
import { toCsv } from '@/lib/csv';
import { centsToDecimal } from '@/lib/money';

export const dynamic = 'force-dynamic';

const TABLES = ['transactions', 'cards', 'categories', 'rules'] as const;
type Table = (typeof TABLES)[number];

/** GET /api/export?table=transactions|cards|categories|rules → CSV download */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { supabase } = auth;
  const table = (req.nextUrl.searchParams.get('table') ?? 'transactions') as Table;
  if (!TABLES.includes(table)) return fail(400, 'Unknown table');

  const [{ data: cards }, { data: cats }, { data: budgets }] = await Promise.all([
    supabase.from('cards').select('*').order('sort'),
    supabase.from('categories').select('*').order('sort'),
    supabase.from('budgets').select('category_id,amount_cents'),
  ]);
  const cardName = new Map((cards ?? []).map((c) => [c.id, c.name]));
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));

  let csv: string;
  if (table === 'transactions') {
    const rows: unknown[][] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('occurred_at', { ascending: false })
        .range(from, from + 999);
      if (error) return fail(500, error.message);
      for (const t of data ?? [])
        rows.push([
          t.id, t.occurred_at, centsToDecimal(Number(t.amount_cents)), t.currency, t.merchant,
          t.card_id ? cardName.get(t.card_id) ?? '' : '', t.raw_card ?? '',
          t.category_id ? catName.get(t.category_id) ?? '' : '', t.note ?? '', t.source,
        ]);
      if (!data || data.length < 1000) break;
    }
    csv = toCsv(['id', 'date', 'amount', 'currency', 'merchant', 'card', 'card_name_from_wallet', 'category', 'note', 'source'], rows);
  } else if (table === 'cards') {
    csv = toCsv(
      ['id', 'name', 'last4', 'type', 'color', 'monthly_limit', 'archived'],
      (cards ?? []).map((c) => [c.id, c.name, c.last4 ?? '', c.type, c.color, c.monthly_limit_cents == null ? '' : centsToDecimal(Number(c.monthly_limit_cents)), c.archived]),
    );
  } else if (table === 'categories') {
    const b = new Map((budgets ?? []).map((x) => [x.category_id, Number(x.amount_cents)]));
    csv = toCsv(['id', 'name', 'icon', 'color', 'monthly_budget'], (cats ?? []).map((c) => [c.id, c.name, c.icon, c.color, centsToDecimal(b.get(c.id) ?? 0)]));
  } else {
    const { data: rules } = await supabase.from('merchant_rules').select('*').order('keyword');
    csv = toCsv(['keyword', 'category', 'source'], (rules ?? []).map((r) => [r.keyword, catName.get(r.category_id) ?? '', r.source]));
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pocket-ledger-${table}-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
