'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Sheet } from './Sheet';
import { api } from '@/lib/client/api';
import { refreshAll } from '@/lib/client/data';
import { useShell } from './AppShell';
import type { Card } from '@/lib/types';

/** Prompts once per unknown Wallet card name: "Which of your cards is 'Amex Cobalt'?" */
export function UnknownCards({ unknown, cards }: { unknown: { raw_card: string; count: number }[]; cards: Card[] }) {
  const { toast } = useShell();
  const [mapping, setMapping] = useState<string | null>(null);
  if (!unknown.length) return null;

  async function map(alias: string, cardId: string) {
    try {
      const r = await api<{ updated: number }>('/api/cards/aliases', { body: { alias, card_id: cardId } });
      toast(`Linked “${alias}” · ${r.updated} transaction${r.updated === 1 ? '' : 's'} updated`);
      setMapping(null);
      refreshAll();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      {unknown.slice(0, 3).map((u) => (
        <button key={u.raw_card} className="banner info" style={{ width: '100%', border: 0, textAlign: 'left' }} onClick={() => setMapping(u.raw_card)}>
          <span style={{ fontSize: 22 }} aria-hidden>💳</span>
          <span style={{ flex: 1 }}>
            <strong>New card from Wallet: “{u.raw_card}”</strong>
            <div className="muted" style={{ fontSize: 14 }}>{u.count} transaction{u.count === 1 ? '' : 's'} · tap to link it to one of your cards</div>
          </span>
        </button>
      ))}
      <Sheet open={!!mapping} onClose={() => setMapping(null)} title="Link Card">
        <p className="muted" style={{ margin: '4px 4px 12px' }}>Apple Wallet calls this card “{mapping}”. Which card is it? You’ll only be asked once.</p>
        <div className="group">
          {cards.filter((c) => !c.archived).map((c) => (
            <button key={c.id} className="cell chev" onClick={() => mapping && map(mapping, c.id)}>
              <span className="dot" style={{ background: c.color, width: 14, height: 14 }} />
              <span className="label">{c.name}{c.last4 ? ` ·${c.last4}` : ''}</span>
            </button>
          ))}
        </div>
        <Link href={`/settings/cards?new=${encodeURIComponent(mapping ?? '')}`} className="btn secondary" style={{ marginTop: 16 }} onClick={() => setMapping(null)}>
          + Create a new card
        </Link>
      </Sheet>
    </>
  );
}
