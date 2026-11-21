'use client';
import { useMemo, useState } from 'react';
import { useBootstrap, refreshAll } from '@/lib/client/data';
import { api } from '@/lib/client/api';
import { currentMonthKey, formatCents } from '@/lib/client/format';
import { centsToDecimal } from '@/lib/money';
import { MonthNav } from '@/components/MonthNav';
import { Sheet } from '@/components/Sheet';
import { useShell } from '@/components/AppShell';

export default function BudgetPage() {
  const [month, setMonth] = useState(currentMonthKey());
  const { data } = useBootstrap(month);
  const { toast } = useShell();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newCat, setNewCat] = useState({ name: '', icon: '', budget: '' });
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  const currency = data?.user.currency ?? 'CAD';
  const txs = useMemo(() => data?.transactions ?? [], [data]);
  const budgets = new Map((data?.budgets ?? []).map((b) => [b.category_id, Number(b.amount_cents)]));
  const spentBy = new Map<string | null, number>();
  for (const t of txs) spentBy.set(t.category_id, (spentBy.get(t.category_id) ?? 0) + t.amount_cents);

  const totalBudget = [...budgets.values()].reduce((a, b) => a + b, 0);
  const totalSpent = txs.reduce((s, t) => s + t.amount_cents, 0);
  const left = totalBudget - totalSpent;

  // daily spend for the bar chart
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrent = month === currentMonthKey();
  const today = new Date().getDate();
  const daily = useMemo(() => {
    const arr = Array<number>(daysInMonth).fill(0);
    for (const t of txs) {
      const d = new Date(t.occurred_at);
      if (d.getMonth() + 1 === m) arr[d.getDate() - 1] += Math.max(0, t.amount_cents);
    }
    return arr;
  }, [txs, daysInMonth, m]);
  const maxDay = Math.max(1, ...daily);
  const daysLeft = isCurrent ? daysInMonth - today + 1 : 0;

  function startEdit() {
    setDraft(Object.fromEntries((data?.categories ?? []).map((c) => [c.id, centsToDecimal(budgets.get(c.id) ?? 0)])));
    setEditing(true);
  }
  async function saveBudgets() {
    try {
      await api('/api/budgets', { method: 'PUT', body: { budgets: Object.entries(draft).map(([category_id, amount]) => ({ category_id, amount })) } });
      if (newCat.name.trim()) {
        await api('/api/categories', { body: { name: newCat.name, icon: newCat.icon || '•', budget: newCat.budget, color: '#008300' } });
        setNewCat({ name: '', icon: '', budget: '' });
      }
      toast('Budgets saved');
      setEditing(false);
      refreshAll();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="page">
      <div className="nav-row" style={{ alignItems: 'flex-end' }}>
        <h1 className="large-title" style={{ marginBottom: 4 }}>Budget</h1>
        <button className="link-btn" onClick={startEdit} disabled={!data}>Edit</button>
      </div>
      <MonthNav month={month} onChange={(mm) => { setMonth(mm); setPickedDay(null); }} />

      <div className="kpis" style={{ marginTop: 4 }}>
        <div className="kpi"><div className="k">Spent</div><div className="v">{formatCents(totalSpent, currency, { compact: true })}</div></div>
        <div className="kpi"><div className="k">Budget</div><div className="v">{formatCents(totalBudget, currency, { compact: true })}</div></div>
        <div className="kpi">
          <div className="k">{left < 0 ? 'Over' : 'Left'}</div>
          <div className="v" style={{ color: left < 0 ? 'var(--bad)' : undefined }}>{left < 0 ? '⚠︎ ' : ''}{formatCents(Math.abs(left), currency, { compact: true })}</div>
        </div>
      </div>
      {isCurrent && left > 0 && daysLeft > 0 && (
        <p className="footnote">≈ {formatCents(Math.floor(left / daysLeft), currency)} per day for the next {daysLeft} day{daysLeft === 1 ? '' : 's'}.</p>
      )}

      <div className="section-title">Daily spending</div>
      <div className="group" style={{ padding: '8px 12px 10px' }}>
        <div className="bars" role="img" aria-label="Spending per day">
          {pickedDay !== null && (
            <span className="bar-tip" style={{ left: `${((pickedDay + 0.5) / daysInMonth) * 100}%` }}>
              {new Date(y, m - 1, pickedDay + 1).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} · {formatCents(daily[pickedDay], currency)}
            </span>
          )}
          {daily.map((v, i) => (
            <button
              key={i}
              className={isCurrent && i + 1 > today ? 'future' : ''}
              aria-label={`Day ${i + 1}: ${formatCents(v, currency)}`}
              aria-pressed={pickedDay === i}
              onClick={() => setPickedDay(pickedDay === i ? null : i)}
            >
              <i style={{ height: `${(v / maxDay) * 100}%` }} />
            </button>
          ))}
        </div>
        <div className="axis"><span>1</span><span>{Math.ceil(daysInMonth / 2)}</span><span>{daysInMonth}</span></div>
      </div>

      <div className="section-title">Categories</div>
      <div className="group">
        {(data?.categories ?? []).map((c) => {
          const spent = spentBy.get(c.id) ?? 0;
          const budget = budgets.get(c.id) ?? 0;
          const pct = budget ? (spent / budget) * 100 : 0;
          const over = budget > 0 && spent > budget;
          const near = !over && pct >= 80;
          return (
            <div key={c.id} className="cell" style={{ display: 'block', padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="icon-badge" style={{ background: c.color }} aria-hidden>{c.icon}</span>
                <span className="label" style={{ fontWeight: 500 }}>{c.name}</span>
                <span className="tabular" style={{ fontWeight: 600 }}>{formatCents(spent, currency)}</span>
              </div>
              {budget > 0 ? (
                <>
                  <div className="meter" style={{ marginTop: 10 }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} budget used`}>
                    <i style={{ width: `${Math.min(100, pct)}%`, background: c.color }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 6 }}>
                    <span style={{ color: over ? 'var(--bad)' : near ? 'var(--warn)' : 'var(--text-3)', fontWeight: over || near ? 600 : 400 }}>
                      {over ? `⚠︎ ${formatCents(spent - budget, currency)} over` : near ? `● ${Math.round(pct)}% used` : `${formatCents(budget - spent, currency)} left`}
                    </span>
                    <span className="faint tabular">of {formatCents(budget, currency, { compact: true })}</span>
                  </div>
                </>
              ) : (
                <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>No budget set</div>
              )}
            </div>
          );
        })}
        {(spentBy.get(null) ?? 0) !== 0 && (
          <div className="cell"><span className="icon-badge" style={{ background: '#8a8984' }}>❔</span><span className="label">Uncategorized</span><span className="tabular" style={{ fontWeight: 600 }}>{formatCents(spentBy.get(null) ?? 0, currency)}</span></div>
        )}
      </div>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Monthly Budgets" action={<button className="link-btn" style={{ fontWeight: 600 }} onClick={saveBudgets}>Save</button>}>
        <div className="group">
          {(data?.categories ?? []).map((c) => (
            <label key={c.id} className="field field-label">
              <span>{c.icon} {c.name}</span>
              <input className="text" inputMode="decimal" style={{ textAlign: 'right', paddingRight: 16 }} value={draft[c.id] ?? ''} placeholder="0.00"
                onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value.replace(/[^0-9.,]/g, '') })} />
            </label>
          ))}
        </div>
        <p className="footnote">Budgets repeat every month. You’ll get a notification at 80% and 100%.</p>
        <div className="section-title">New category</div>
        <div className="group">
          <label className="field field-label"><span>Name</span><input className="text" value={newCat.name} placeholder="e.g. Pets" onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} /></label>
          <label className="field field-label"><span>Emoji</span><input className="text" value={newCat.icon} placeholder="🐶" maxLength={4} onChange={(e) => setNewCat({ ...newCat, icon: e.target.value })} /></label>
          <label className="field field-label"><span>Budget</span><input className="text" inputMode="decimal" value={newCat.budget} placeholder="0.00" onChange={(e) => setNewCat({ ...newCat, budget: e.target.value })} /></label>
        </div>
      </Sheet>
    </div>
  );
}
