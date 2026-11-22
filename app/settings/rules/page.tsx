'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/client/api';
import { useBootstrap } from '@/lib/client/data';
import { BackLink } from '@/components/BackLink';
import { useShell } from '@/components/AppShell';
import type { MerchantRule } from '@/lib/types';

export default function RulesPage() {
  const { data: boot } = useBootstrap();
  const { data, mutate } = useSWR<{ rules: MerchantRule[] }>('/api/rules', fetcher);
  const { toast } = useShell();
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [filter, setFilter] = useState('');
  const cat = new Map((boot?.categories ?? []).map((c) => [c.id, c]));

  async function add() {
    try {
      await api('/api/rules', { body: { keyword, category_id: categoryId } });
      setKeyword('');
      mutate();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function remove(id: string) {
    await api(`/api/rules?id=${id}`, { method: 'DELETE' }).catch((e) => toast(e.message));
    mutate();
  }

  const rules = (data?.rules ?? []).filter((r) => !filter || r.keyword.includes(filter.toLowerCase()));
  const learned = rules.filter((r) => r.source === 'user');
  const defaults = rules.filter((r) => r.source === 'default');

  const list = (items: MerchantRule[]) => (
    <div className="group">
      {items.map((r) => {
        const c = cat.get(r.category_id);
        return (
          <div key={r.id} className="cell">
            <span className="label ellipsis"><code>{r.keyword}</code></span>
            <span className="value" style={{ fontSize: 15 }}>{c ? `${c.icon} ${c.name}` : '—'}</span>
            <button className="link-btn danger" aria-label={`Delete rule ${r.keyword}`} onClick={() => remove(r.id)}>✕</button>
          </div>
        );
      })}
      {!items.length && <div className="cell faint">None</div>}
    </div>
  );

  return (
    <div className="page">
      <BackLink />
      <h1 className="large-title">Auto-categorize</h1>
      <p className="muted" style={{ margin: '0 4px 12px' }}>
        When a merchant name contains a keyword, it gets that category. Your own rules (including corrections you make on a transaction) win over the defaults.
      </p>

      <div className="section-title">Add a rule</div>
      <div className="group">
        <label className="field field-label"><span>Keyword</span><input className="text" placeholder="e.g. farmers market" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></label>
        <label className="field field-label">
          <span>Category</span>
          <select className="text" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose…</option>
            {boot?.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </label>
      </div>
      <button className="btn" style={{ marginTop: 12 }} disabled={keyword.trim().length < 2 || !categoryId} onClick={add}>Add Rule</button>

      <div className="input-pill" style={{ marginTop: 24 }}>
        <input className="text" type="search" placeholder="Search rules" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="section-title">Learned & custom ({learned.length})</div>
      {list(learned)}
      <div className="section-title">Built-in ({defaults.length})</div>
      {list(defaults)}
    </div>
  );
}
