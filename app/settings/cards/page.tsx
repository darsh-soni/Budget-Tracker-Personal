'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBootstrap, refreshAll } from '@/lib/client/data';
import { api } from '@/lib/client/api';
import { formatCents } from '@/lib/client/format';
import { centsToDecimal } from '@/lib/money';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { BackLink } from '@/components/BackLink';
import { useShell } from '@/components/AppShell';
import type { Card } from '@/lib/types';

const SWATCHES = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#008300', '#6250d6', '#e34948', '#1c1c1e', '#8a8984'];

interface Draft { id?: string; name: string; last4: string; color: string; type: 'credit' | 'debit'; monthly_limit: string; archived: boolean }
const blank = (name = ''): Draft => ({ name, last4: '', color: SWATCHES[0], type: 'credit', monthly_limit: '', archived: false });

export default function CardsSettings() {
  const { data } = useBootstrap();
  const { toast } = useShell();
  const params = useSearchParams();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [linkAlias, setLinkAlias] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const alias = params.get('new');
    if (alias !== null) {
      setLinkAlias(alias || null);
      setDraft(blank(alias));
      router.replace('/settings/cards');
    }
  }, [params, router]);

  const edit = (c: Card) =>
    setDraft({ id: c.id, name: c.name, last4: c.last4 ?? '', color: c.color, type: c.type, monthly_limit: c.monthly_limit_cents == null ? '' : centsToDecimal(c.monthly_limit_cents), archived: c.archived });

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const body = { name: draft.name, last4: draft.last4, color: draft.color, type: draft.type, monthly_limit: draft.monthly_limit || null, archived: draft.archived };
      if (draft.id) await api(`/api/cards/${draft.id}`, { method: 'PATCH', body });
      else {
        const r = await api<{ card: Card; attached: number }>('/api/cards', { body });
        if (linkAlias) await api('/api/cards/aliases', { body: { alias: linkAlias, card_id: r.card.id } });
        if (r.attached) toast(`Card added · ${r.attached} Wallet transactions matched`);
      }
      setDraft(null);
      setLinkAlias(null);
      refreshAll();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.id || !confirm('Delete this card? Its transactions are kept but become unassigned.')) return;
    await api(`/api/cards/${draft.id}`, { method: 'DELETE' }).catch((e) => toast(e.message));
    setDraft(null);
    refreshAll();
  }

  const cards = data?.cards ?? [];
  return (
    <div className="page">
      <BackLink />
      <div className="nav-row" style={{ alignItems: 'flex-end' }}>
        <h1 className="large-title" style={{ marginBottom: 4 }}>Cards</h1>
        <button className="link-btn" onClick={() => setDraft(blank())}>Add</button>
      </div>
      {cards.length === 0 ? (
        <div className="empty">Add the cards you use with Apple Pay. Name them like they appear in Wallet so transactions match automatically.</div>
      ) : (
        <div className="group">
          {cards.map((c) => (
            <button key={c.id} className="cell chev" onClick={() => edit(c)} style={{ opacity: c.archived ? 0.5 : 1 }}>
              <span style={{ width: 44, height: 28, borderRadius: 5, background: c.color, flex: 'none' }} aria-hidden />
              <span className="label">
                <div>{c.name}{c.archived ? ' (archived)' : ''}</div>
                <div className="faint" style={{ fontSize: 13 }}>
                  {c.type === 'credit' ? 'Credit' : 'Debit'}{c.last4 ? ` ·· ${c.last4}` : ''}{c.monthly_limit_cents ? ` · limit ${formatCents(c.monthly_limit_cents, data?.user.currency, { compact: true })}` : ''}
                </div>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="footnote">Tip: use the same name Apple Wallet shows (e.g. “Amex Cobalt”). Unknown names are flagged on the Cards tab so you can link them once.</p>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit Card' : 'New Card'} action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={busy || !draft?.name.trim()} onClick={save}>Save</button>}>
        {draft && (
          <>
            <div className="pay-card" style={{ background: draft.color, margin: '4px 0 16px', minHeight: 150 }}>
              <div className="top"><span>{draft.name || 'Card name'}</span><span className="kind">{draft.type}</span></div>
              <div className="sub">{draft.last4 ? `•••• ${draft.last4}` : '•••• ••••'}</div>
            </div>
            {linkAlias && <p className="footnote" style={{ marginTop: 0, marginBottom: 8 }}>Wallet transactions from “{linkAlias}” will be linked to this card.</p>}
            <div className="group">
              <label className="field field-label"><span>Name</span><input className="text" value={draft.name} placeholder="Amex Cobalt" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label className="field field-label"><span>Last 4</span><input className="text" inputMode="numeric" maxLength={4} value={draft.last4} placeholder="1234" onChange={(e) => setDraft({ ...draft, last4: e.target.value.replace(/\D/g, '') })} /></label>
              <label className="field field-label"><span>Limit</span><input className="text" inputMode="decimal" value={draft.monthly_limit} placeholder="Optional monthly limit" onChange={(e) => setDraft({ ...draft, monthly_limit: e.target.value.replace(/[^0-9.,]/g, '') })} /></label>
            </div>
            <div className="section-title">Type</div>
            <div className="segmented">
              {(['credit', 'debit'] as const).map((t) => (
                <button key={t} aria-pressed={draft.type === t} onClick={() => setDraft({ ...draft, type: t })}>{t === 'credit' ? 'Credit' : 'Debit'}</button>
              ))}
            </div>
            <div className="section-title">Color</div>
            <div className="chips wrap">
              {SWATCHES.map((s) => (
                <button key={s} aria-label={`Color ${s}`} aria-pressed={draft.color === s} onClick={() => setDraft({ ...draft, color: s })}
                  style={{ width: 44, height: 44, borderRadius: '50%', background: s, border: draft.color === s ? '3px solid var(--text)' : '3px solid transparent' }} />
              ))}
            </div>
            {draft.id && (
              <>
                <div className="group" style={{ marginTop: 20 }}>
                  <div className="cell"><span className="label">Archived<div className="faint" style={{ fontSize: 13 }}>Hide from the dashboard and quick entry</div></span>
                    <Switch checked={draft.archived} onChange={(v) => setDraft({ ...draft, archived: v })} label="Archived" /></div>
                </div>
                <button className="btn danger" style={{ marginTop: 20 }} onClick={remove}>Delete Card</button>
              </>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}
