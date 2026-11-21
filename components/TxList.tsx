'use client';
import { useShell } from './AppShell';
import { dayLabel, formatCents, timeLabel } from '@/lib/client/format';
import type { Card, Category, Transaction } from '@/lib/types';

export function TxList({
  transactions, cards, categories, currency, showCard = true, empty = 'No transactions yet.',
}: {
  transactions: Transaction[];
  cards: Card[];
  categories: Category[];
  currency: string;
  showCard?: boolean;
  empty?: string;
}) {
  const { openEdit } = useShell();
  if (!transactions.length) return <div className="empty">{empty}</div>;
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const groups: { day: string; items: Transaction[]; total: number }[] = [];
  for (const t of transactions) {
    const day = new Date(t.occurred_at).toDateString();
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) { g = { day, items: [], total: 0 }; groups.push(g); }
    g.items.push(t);
    g.total += t.amount_cents;
  }

  return (
    <>
      {groups.map((g) => (
        <section key={g.day}>
          <div className="day-header">
            <span>{dayLabel(g.items[0].occurred_at)}</span>
            <span className="tabular">{formatCents(g.total, currency)}</span>
          </div>
          <div className="group">
            {g.items.map((t) => {
              const cat = t.category_id ? catMap.get(t.category_id) : undefined;
              const card = t.card_id ? cardMap.get(t.card_id) : undefined;
              return (
                <button key={t.id} className="cell indented" onClick={() => openEdit(t)}>
                  <span className="icon-badge" style={{ background: cat?.color ?? '#8a8984' }} aria-hidden>{cat?.icon ?? '❔'}</span>
                  <span className="label">
                    <div className="ellipsis" style={{ fontWeight: 500 }}>{t.merchant}</div>
                    <div className="faint ellipsis" style={{ fontSize: 13 }}>
                      {cat?.name ?? 'Uncategorized'}
                      {showCard && <> · {card ? card.name : t.raw_card ? `${t.raw_card} (unmapped)` : 'No card'}</>}
                      {' · '}{timeLabel(t.occurred_at)}
                      {t.source === 'wallet' && ' · Wallet'}
                    </div>
                  </span>
                  <span className={`tx-amount${t.amount_cents < 0 ? ' refund' : ''}`}>{formatCents(t.amount_cents, currency, { sign: t.amount_cents < 0 })}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
