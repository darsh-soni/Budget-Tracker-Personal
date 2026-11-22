'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useBootstrap } from '@/lib/client/data';
import { currentMonthKey, formatCents } from '@/lib/client/format';
import { MonthNav } from '@/components/MonthNav';
import { TxList } from '@/components/TxList';
import { UnknownCards } from '@/components/UnknownCards';
import type { Card, Transaction } from '@/lib/types';

const NO_CARD = '#8a8984';

export default function Dashboard() {
  const params = useSearchParams();
  const [month, setMonth] = useState(currentMonthKey());
  const { data, error, isLoading } = useBootstrap(month);
  const [active, setActive] = useState(0); // 0 = All cards
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const cards = useMemo(() => (data?.cards ?? []).filter((c) => !c.archived), [data]);
  const currency = data?.user.currency ?? 'CAD';
  const txs = useMemo(() => data?.transactions ?? [], [data]);

  const byCard = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const t of txs) m.set(t.card_id, (m.get(t.card_id) ?? 0) + t.amount_cents);
    return m;
  }, [txs]);
  const total = txs.reduce((s, t) => s + t.amount_cents, 0);

  // deep link from a push notification: /?card=<id>
  useEffect(() => {
    const id = params.get('card');
    const idx = cards.findIndex((c) => c.id === id);
    if (idx >= 0) scrollTo(idx + 1);
  }, [params, cards]); // eslint-disable-line react-hooks/exhaustive-deps

  function scrollTo(i: number) {
    const el = scroller.current;
    const slide = el?.children[i] as HTMLElement | undefined;
    if (el && slide) el.scrollTo({ left: slide.offsetLeft - 16, behavior: 'smooth' });
    setActive(i);
  }
  function onScroll() {
    const el = scroller.current;
    if (!el || !el.children.length) return;
    const w = (el.children[0] as HTMLElement).offsetWidth + 12;
    setActive(Math.max(0, Math.min(cards.length, Math.round(el.scrollLeft / w))));
  }

  const activeCard: Card | null = active > 0 ? cards[active - 1] ?? null : null;
  const visibleTx: Transaction[] = activeCard ? txs.filter((t) => t.card_id === activeCard.id) : txs;

  if (error) return <div className="page"><h1 className="large-title">Cards</h1><div className="empty">{error.message}</div></div>;

  return (
    <div className="page">
      <h1 className="large-title">Cards</h1>
      <MonthNav month={month} onChange={setMonth} />

      {data && <UnknownCards unknown={data.unknownCards} cards={data.cards} />}

      <div className="carousel" ref={scroller} onScroll={onScroll} aria-label="Cards">
        <div className="pay-card all" role="group" aria-label="All cards">
          <div className="top"><span>All cards</span><span className="kind">{cards.length} card{cards.length === 1 ? '' : 's'}</span></div>
          <div>
            <div className="sub">Spent this month</div>
            <div className="amount">{isLoading && !data ? '—' : formatCents(total, currency)}</div>
            <div className="sub">{txs.length} transaction{txs.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        {cards.map((c) => {
          const spent = byCard.get(c.id) ?? 0;
          const limit = c.monthly_limit_cents;
          const pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
          return (
            <div key={c.id} className="pay-card" style={{ background: c.color }} role="group" aria-label={c.name}>
              <div className="top">
                <span className="ellipsis">{c.name}</span>
                <span className="kind">{c.type}{c.last4 ? ` ·· ${c.last4}` : ''}</span>
              </div>
              <div>
                <div className="sub">Month to date</div>
                <div className="amount">{formatCents(spent, currency)}</div>
                {limit ? (
                  <>
                    <div className="meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Limit used"><i style={{ width: `${pct}%` }} /></div>
                    <div className="sub" style={{ marginTop: 6 }}>
                      {spent > limit ? `${formatCents(spent - limit, currency)} over` : `${formatCents(limit - spent, currency)} left`} of {formatCents(limit, currency, { compact: true })} limit
                    </div>
                  </>
                ) : (
                  <div className="sub">No monthly limit</div>
                )}
              </div>
            </div>
          );
        })}
        {cards.length === 0 && data && (
          <Link href="/settings/cards" className="pay-card" style={{ background: 'var(--fill)', color: 'var(--text)', boxShadow: 'none', justifyContent: 'center', alignItems: 'center' }}>
            <span style={{ fontSize: 34 }}>＋</span>
            <span style={{ fontWeight: 600 }}>Add your first card</span>
          </Link>
        )}
      </div>
      {cards.length > 0 && (
        <div className="dots" aria-hidden>
          {[null, ...cards].map((c, i) => <i key={c?.id ?? 'all'} className={i === active ? 'on' : ''} />)}
        </div>
      )}

      {!activeCard && total !== 0 && (
        <>
          <div className="section-title">Spending by card</div>
          <CardBreakdown cards={cards} byCard={byCard} total={total} currency={currency} picked={picked} onPick={setPicked} onOpen={(id) => scrollTo(cards.findIndex((c) => c.id === id) + 1)} />
        </>
      )}

      {data && (data.user.last_wallet_at === null && cards.length > 0) && (
        <Link href="/settings/wallet" className="banner" style={{ marginTop: 16, color: 'var(--text)' }}>
          <span style={{ fontSize: 22 }} aria-hidden>⚡️</span>
          <span style={{ flex: 1 }}><strong>Log Apple Pay taps automatically</strong><div className="muted" style={{ fontSize: 14 }}>Set up the Shortcuts automation in 2 minutes.</div></span>
          <span className="chev" />
        </Link>
      )}

      <div className="section-title" style={{ marginTop: 24 }}>{activeCard ? `${activeCard.name} transactions` : 'Transactions'}</div>
      {data && (
        <TxList
          transactions={visibleTx}
          cards={data.cards}
          categories={data.categories}
          currency={currency}
          showCard={!activeCard}
          empty={activeCard ? 'No spending on this card this month.' : 'Nothing yet this month. Tap ＋ to add an expense.'}
        />
      )}
    </div>
  );
}

function CardBreakdown({
  cards, byCard, total, currency, picked, onPick, onOpen,
}: {
  cards: Card[];
  byCard: Map<string | null, number>;
  total: number;
  currency: string;
  picked: string | null;
  onPick: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const rows = [
    ...cards.map((c) => ({ id: c.id, name: c.name, color: c.color, cents: byCard.get(c.id) ?? 0 })),
    { id: 'none', name: 'No card / cash', color: NO_CARD, cents: byCard.get(null) ?? 0 },
  ].filter((r) => r.cents > 0);
  const positive = rows.reduce((s, r) => s + r.cents, 0) || 1;
  const pickedRow = rows.find((r) => r.id === picked);

  return (
    <div className="group" style={{ padding: 16 }}>
      <div style={{ minHeight: 22, fontSize: 15, marginBottom: 8 }} aria-live="polite">
        {pickedRow ? (
          <><strong>{pickedRow.name}</strong> · <span className="tabular">{formatCents(pickedRow.cents, currency)}</span> <span className="faint">({Math.round((pickedRow.cents / positive) * 100)}%)</span></>
        ) : (
          <span className="faint">Tap a segment for details · total {formatCents(total, currency)}</span>
        )}
      </div>
      <div className="stack" role="img" aria-label="Share of spending by card">
        {rows.map((r) => (
          <button
            key={r.id}
            aria-label={`${r.name} ${formatCents(r.cents, currency)}`}
            aria-pressed={picked === r.id}
            style={{ flexGrow: r.cents, flexBasis: 0, background: r.color }}
            onClick={() => onPick(picked === r.id ? null : r.id)}
          />
        ))}
      </div>
      {/* legend doubles as the table view: name, amount, share */}
      <div style={{ marginTop: 12 }}>
        {rows.map((r) => (
          <button
            key={r.id}
            className="cell"
            style={{ padding: '8px 0' }}
            onClick={() => (r.id === 'none' ? onPick(r.id) : onOpen(r.id))}
          >
            <span className="dot" style={{ background: r.color }} />
            <span className="label ellipsis">{r.name}</span>
            <span className="faint tabular" style={{ fontSize: 14 }}>{Math.round((r.cents / positive) * 100)}%</span>
            <span className="tabular" style={{ fontWeight: 600, minWidth: 84, textAlign: 'right' }}>{formatCents(r.cents, currency)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
