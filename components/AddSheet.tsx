'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { api, ApiError } from '@/lib/client/api';
import { refreshAll, useBootstrap } from '@/lib/client/data';
import { enqueue, newClientId } from '@/lib/client/queue';
import { toLocalInput } from '@/lib/client/format';
import { parseAmountToCents } from '@/lib/money';

const LAST_CARD = 'pl-last-card';

export function AddSheet({ open, onClose, toast }: { open: boolean; onClose: () => void; toast: (m: string) => void }) {
  const { data } = useBootstrap();
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [cardId, setCardId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const cards = useMemo(() => (data?.cards ?? []).filter((c) => !c.archived), [data]);

  useEffect(() => {
    if (!open) return;
    setAmount(''); setMerchant(''); setCategoryId(null); setNote(''); setMore(false); setWhen(toLocalInput(new Date()));
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_CARD); } catch {}
    setCardId(cards.find((c) => c.id === last)?.id ?? cards[0]?.id ?? null);
    // keyboard is already up via the proxy input focused in the tap handler; move focus here
    requestAnimationFrame(() => amountRef.current?.focus());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const recent = useMemo(() => {
    const map = new Map<string, { merchant: string; count: number; category_id: string | null; card_id: string | null }>();
    for (const t of data?.transactions ?? []) {
      const e = map.get(t.merchant_key) ?? { merchant: t.merchant, count: 0, category_id: t.category_id, card_id: t.card_id };
      e.count++;
      map.set(t.merchant_key, e);
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  }, [data]);

  const cents = parseAmountToCents(amount);
  const canSave = !!cents && cents > 0 && merchant.trim().length > 0 && !saving;

  async function save() {
    if (!canSave || !cents) return;
    setSaving(true);
    const entry = {
      client_id: newClientId(),
      amount_cents: cents,
      merchant: merchant.trim(),
      card_id: cardId,
      category_id: categoryId,
      occurred_at: new Date(when || Date.now()).toISOString(),
      note: note.trim() || null,
    };
    try { if (cardId) localStorage.setItem(LAST_CARD, cardId); } catch {}
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      await api('/api/transactions', { body: entry });
      toast('Expense added');
      refreshAll();
    } catch (e) {
      if (e instanceof ApiError) {
        toast(e.message);
        setSaving(false);
        return;
      }
      enqueue({ ...entry, queued_at: new Date().toISOString() });
      toast('Offline — saved and will sync when you reconnect');
    }
    setSaving(false);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add Expense" action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={!canSave} onClick={save}>Add</button>}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="group">
          <input
            ref={amountRef}
            className="text amount-input"
            inputMode="decimal"
            enterKeyHint="next"
            placeholder="$0.00"
            aria-label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
          />
        </div>

        <div className="group" style={{ marginTop: 12 }}>
          <input
            className="text"
            placeholder="Merchant"
            aria-label="Merchant"
            autoCapitalize="words"
            autoComplete="off"
            enterKeyHint="done"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          />
        </div>
        {recent.length > 0 && (
          <div className="chips" style={{ marginTop: 8 }}>
            {recent.map((r) => (
              <button
                type="button"
                key={r.merchant}
                className="chip"
                aria-pressed={merchant === r.merchant}
                onClick={() => { setMerchant(r.merchant); if (r.category_id) setCategoryId(r.category_id); }}
              >
                {r.merchant}
              </button>
            ))}
          </div>
        )}

        <div className="section-title">Card</div>
        {cards.length ? (
          <div className="chips">
            {cards.map((c) => (
              <button type="button" key={c.id} className="chip" aria-pressed={cardId === c.id} onClick={() => setCardId(c.id)}>
                <span className="dot" style={{ background: c.color }} />
                {c.name}{c.last4 ? ` ·${c.last4}` : ''}
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={cardId === null} onClick={() => setCardId(null)}>Cash / other</button>
          </div>
        ) : (
          <p className="footnote">No cards yet — add them in Settings → Cards.</p>
        )}

        <div className="section-title">Category</div>
        <div className="chips wrap">
          <button type="button" className="chip" aria-pressed={categoryId === null} onClick={() => setCategoryId(null)}>✨ Auto</button>
          {(data?.categories ?? []).map((c) => (
            <button type="button" key={c.id} className="chip" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
              {c.icon} {c.name}
            </button>
          ))}
        </div>

        {more ? (
          <div className="group" style={{ marginTop: 16 }}>
            <label className="field field-label">
              <span>Date</span>
              <input className="text" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <label className="field">
              <textarea className="text" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </label>
          </div>
        ) : (
          <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setMore(true)}>Date & note…</button>
        )}

        <button className="btn" type="submit" style={{ marginTop: 20 }} disabled={!canSave}>
          {saving ? 'Saving…' : 'Add Expense'}
        </button>
      </form>
    </Sheet>
  );
}
