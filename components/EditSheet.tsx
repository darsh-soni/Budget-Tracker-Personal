'use client';
import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { Switch } from './Switch';
import { api } from '@/lib/client/api';
import { refreshAll, useBootstrap } from '@/lib/client/data';
import { toLocalInput } from '@/lib/client/format';
import { centsToDecimal, parseAmountToCents } from '@/lib/money';
import type { Transaction } from '@/lib/types';

export function EditSheet({ tx, onClose, toast }: { tx: Transaction | null; onClose: () => void; toast: (m: string) => void }) {
  const { data } = useBootstrap();
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [cardId, setCardId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [applySimilar, setApplySimilar] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tx) return;
    setAmount(centsToDecimal(tx.amount_cents));
    setMerchant(tx.merchant);
    setCardId(tx.card_id);
    setCategoryId(tx.category_id);
    setWhen(toLocalInput(tx.occurred_at));
    setNote(tx.note ?? '');
    setApplySimilar(true);
  }, [tx]);

  if (!tx) return null;
  const categoryChanged = categoryId !== tx.category_id && categoryId !== null;

  async function save() {
    if (!tx) return;
    const cents = parseAmountToCents(amount);
    if (!cents) return toast('Enter an amount');
    setBusy(true);
    try {
      const res = await api<{ learnedRule: string | null; updatedSimilar: number }>(`/api/transactions/${tx.id}`, {
        method: 'PATCH',
        body: {
          amount_cents: cents, merchant, card_id: cardId, category_id: categoryId,
          occurred_at: new Date(when).toISOString(), note, apply_to_similar: applySimilar,
        },
      });
      toast(res.learnedRule ? `Saved. Future “${tx.merchant}” will use this category${res.updatedSimilar ? ` (+${res.updatedSimilar} updated)` : ''}.` : 'Saved');
      refreshAll();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!tx || !confirm('Delete this transaction?')) return;
    setBusy(true);
    try {
      await api(`/api/transactions/${tx.id}`, { method: 'DELETE' });
      toast('Deleted');
      refreshAll();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cards = (data?.cards ?? []).filter((c) => !c.archived || c.id === tx.card_id);
  return (
    <Sheet open onClose={onClose} title="Transaction" action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>Save</button>}>
      <div className="group">
        <input className="text amount-input" inputMode="decimal" aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,-]/g, ''))} />
      </div>
      <p className="footnote">Use a negative amount for refunds.{tx.source === 'wallet' ? ' Logged from Apple Wallet.' : tx.source === 'import' ? ' Imported from CSV.' : ''}</p>

      <div className="group" style={{ marginTop: 12 }}>
        <label className="field field-label"><span>Merchant</span><input className="text" value={merchant} onChange={(e) => setMerchant(e.target.value)} /></label>
        <label className="field field-label"><span>Date</span><input className="text" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
        <label className="field"><textarea className="text" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
      </div>

      <div className="section-title">Category</div>
      <div className="chips wrap">
        {(data?.categories ?? []).map((c) => (
          <button key={c.id} className="chip" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.icon} {c.name}</button>
        ))}
      </div>
      {categoryChanged && (
        <div className="group" style={{ marginTop: 12 }}>
          <div className="cell">
            <div className="label">
              Apply to all “{tx.merchant}”
              <div className="faint" style={{ fontSize: 13 }}>Future transactions are always remembered.</div>
            </div>
            <Switch checked={applySimilar} onChange={setApplySimilar} label="Apply to similar transactions" />
          </div>
        </div>
      )}

      <div className="section-title">Card</div>
      {tx.raw_card && !tx.card_id && <p className="footnote" style={{ marginTop: 0, marginBottom: 6 }}>Wallet sent “{tx.raw_card}”.</p>}
      <div className="chips wrap">
        {cards.map((c) => (
          <button key={c.id} className="chip" aria-pressed={cardId === c.id} onClick={() => setCardId(c.id)}>
            <span className="dot" style={{ background: c.color }} />{c.name}
          </button>
        ))}
        <button className="chip" aria-pressed={cardId === null} onClick={() => setCardId(null)}>None</button>
      </div>

      <button className="btn danger" style={{ marginTop: 28 }} onClick={remove} disabled={busy}>Delete Transaction</button>
    </Sheet>
  );
}
