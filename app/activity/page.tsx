'use client';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/api';
import { useBootstrap } from '@/lib/client/data';
import { formatCents } from '@/lib/client/format';
import { TxList } from '@/components/TxList';
import { Sheet } from '@/components/Sheet';
import type { Transaction } from '@/lib/types';

interface Page { transactions: Transaction[]; nextBefore: string | null }

export default function Activity() {
  const { data: boot } = useBootstrap();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [card, setCard] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [older, setOlder] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set('q', debounced);
    if (card) p.set('card', card);
    if (category) p.set('category', category);
    if (from) p.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) p.set('to', new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString());
    return p.toString();
  }, [debounced, card, category, from, to]);

  const { data, isLoading } = useSWR<Page>(`/api/transactions?${query}`, fetcher, { keepPreviousData: true });
  useEffect(() => { setOlder([]); setCursor(null); }, [query]);
  useEffect(() => { setCursor(data?.nextBefore ?? null); }, [data]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetcher<Page>(`/api/transactions?${query}&before=${encodeURIComponent(cursor)}`);
      setOlder((o) => [...o, ...page.transactions]);
      setCursor(page.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  }

  const all = [...(data?.transactions ?? []), ...older];
  const total = all.reduce((s, t) => s + t.amount_cents, 0);
  const activeFilters = [card, category, from, to].filter(Boolean).length;
  const currency = boot?.user.currency ?? 'CAD';
  const cardName = (id: string) => (id === 'none' ? 'No card' : boot?.cards.find((c) => c.id === id)?.name ?? 'Card');
  const catName = (id: string) => (id === 'none' ? 'Uncategorized' : boot?.categories.find((c) => c.id === id)?.name ?? 'Category');

  return (
    <div className="page">
      <h1 className="large-title">Activity</h1>
      <div className="row-gap" style={{ flexWrap: 'nowrap' }}>
        <div className="input-pill" style={{ flex: 1 }}>
          <input className="text" type="search" placeholder="Search merchants" aria-label="Search merchants" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        </div>
        <button className="btn small secondary" onClick={() => setFiltersOpen(true)}>Filter{activeFilters ? ` (${activeFilters})` : ''}</button>
      </div>

      {activeFilters > 0 && (
        <div className="chips" style={{ marginTop: 10 }}>
          {card && <button className="chip" aria-pressed onClick={() => setCard('')}>{cardName(card)} ✕</button>}
          {category && <button className="chip" aria-pressed onClick={() => setCategory('')}>{catName(category)} ✕</button>}
          {(from || to) && <button className="chip" aria-pressed onClick={() => { setFrom(''); setTo(''); }}>{from || '…'} → {to || '…'} ✕</button>}
        </div>
      )}

      {(debounced || activeFilters > 0) && all.length > 0 && (
        <p className="footnote" style={{ marginTop: 12 }}>{all.length}{cursor ? '+' : ''} results · {formatCents(total, currency)}</p>
      )}

      {boot && (isLoading && !data ? <div className="empty">Loading…</div> : (
        <TxList transactions={all} cards={boot.cards} categories={boot.categories} currency={currency} empty={debounced || activeFilters ? 'No matching transactions.' : 'No transactions yet.'} />
      ))}
      {cursor && (
        <button className="btn secondary" style={{ marginTop: 16 }} onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>
      )}

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter" action={<button className="link-btn" style={{ fontWeight: 600 }} onClick={() => setFiltersOpen(false)}>Done</button>}>
        <div className="section-title">Card</div>
        <div className="chips wrap">
          <button className="chip" aria-pressed={!card} onClick={() => setCard('')}>Any</button>
          {boot?.cards.map((c) => (
            <button key={c.id} className="chip" aria-pressed={card === c.id} onClick={() => setCard(c.id)}><span className="dot" style={{ background: c.color }} />{c.name}</button>
          ))}
          <button className="chip" aria-pressed={card === 'none'} onClick={() => setCard('none')}>No card</button>
        </div>
        <div className="section-title">Category</div>
        <div className="chips wrap">
          <button className="chip" aria-pressed={!category} onClick={() => setCategory('')}>Any</button>
          {boot?.categories.map((c) => (
            <button key={c.id} className="chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.icon} {c.name}</button>
          ))}
        </div>
        <div className="section-title">Date range</div>
        <div className="group">
          <label className="field field-label"><span>From</span><input className="text" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field field-label"><span>To</span><input className="text" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <button className="btn secondary" style={{ marginTop: 20 }} onClick={() => { setCard(''); setCategory(''); setFrom(''); setTo(''); }}>Reset filters</button>
      </Sheet>
    </div>
  );
}
