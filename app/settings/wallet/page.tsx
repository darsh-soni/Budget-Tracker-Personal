'use client';
import { useEffect, useState } from 'react';
import { useBootstrap, refreshAll } from '@/lib/client/data';
import { api, ApiError } from '@/lib/client/api';
import { formatCents, relativeTime } from '@/lib/client/format';
import { BackLink } from '@/components/BackLink';
import { CopyField } from '@/components/CopyField';
import { useShell } from '@/components/AppShell';

interface TestResult { ok: boolean; parsed?: { amount_cents: number; merchant: string; card: string | null; card_matched: boolean } }

export default function WalletSetup() {
  const { data, mutate } = useBootstrap();
  const { toast } = useShell();
  const [origin, setOrigin] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setOrigin(process.env.NEXT_PUBLIC_APP_URL || window.location.origin), []);
  // poll while this page is open so the user sees their first real tap arrive
  useEffect(() => {
    const t = setInterval(() => mutate(), 10_000);
    return () => clearInterval(t);
  }, [mutate]);

  const endpoint = `${origin}/api/transactions`;
  const token = data?.user.api_token ?? '';
  const firstCard = data?.cards.find((c) => !c.archived)?.name ?? 'My Visa';

  async function sendTest() {
    setTesting(true);
    setResult(null);
    try {
      // Exactly what the Shortcut sends, but with "test": true so nothing is saved.
      const r = await api<TestResult>('/api/transactions', {
        body: { amount: '$4.25', merchant: 'Test Coffee Shop', card: firstCard, timestamp: new Date().toISOString(), test: true },
        headers: { 'X-Api-Key': token },
      });
      setResult({
        ok: true,
        text: `Connection works. ${formatCents(r.parsed?.amount_cents ?? 0, data?.user.currency)} at ${r.parsed?.merchant} → card ${r.parsed?.card_matched ? `matched “${r.parsed?.card}”` : `“${r.parsed?.card}” not matched yet`}.`,
      });
    } catch (e) {
      setResult({ ok: false, text: e instanceof ApiError ? e.message : 'Network error' });
    } finally {
      setTesting(false);
    }
  }

  async function regenerate() {
    if (!confirm('Generate a new key? Your existing Shortcut stops working until you paste the new key into it.')) return;
    try {
      await api('/api/settings/token', { method: 'POST' });
      toast('New key generated — update your Shortcut');
      refreshAll();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="page">
      <BackLink />
      <h1 className="large-title">Connect Apple Wallet</h1>
      <p className="muted" style={{ margin: '0 4px 8px' }}>
        An iPhone Shortcuts automation sends every Apple Pay tap here automatically — amount, merchant and card.
      </p>

      <div className="banner warn">
        <span style={{ fontSize: 20 }} aria-hidden>ⓘ</span>
        <span style={{ fontSize: 15 }}>
          This only captures <strong>Apple Pay taps</strong> made on this iPhone/Apple Watch. For online card-number purchases,
          physical card swipes or pre-authorized bills, use <strong>＋ quick entry</strong> or <a href="/settings/import">import a bank CSV</a>.
        </span>
      </div>

      <div className="section-title">Your endpoint</div>
      <div className="group">
        <CopyField label="URL" value={endpoint} />
        <div style={{ height: 0.5, background: 'var(--separator)', marginLeft: 16 }} />
        <CopyField label="X-Api-Key" value={token} secret />
      </div>
      <div className="group" style={{ marginTop: 12 }}>
        <div className="cell">
          <span className="label">Last transaction received</span>
          <span className="value" style={{ color: data?.user.last_wallet_at ? 'var(--good)' : undefined }}>
            {data?.user.last_wallet_at ? `● ${relativeTime(data.user.last_wallet_at)}` : 'Waiting…'}
          </span>
        </div>
        <button className="cell" onClick={sendTest} disabled={testing || !token}>
          <span className="label" style={{ color: 'var(--accent)' }}>{testing ? 'Sending…' : 'Send test transaction'}</span>
        </button>
        <button className="cell" onClick={regenerate}>
          <span className="label" style={{ color: 'var(--bad)' }}>Regenerate key</span>
        </button>
      </div>
      {result && (
        <p className="footnote" role="status" style={{ color: result.ok ? 'var(--good)' : 'var(--bad)', fontWeight: 500 }}>
          {result.ok ? '✓ ' : '✕ '}{result.text}
        </p>
      )}
      <p className="footnote">The test uses your key exactly like the Shortcut does, but nothing is saved.</p>

      <div className="section-title">Set up the automation (≈ 2 min)</div>
      <ol className="steps group">
        <li>
          <div className="k">Open Shortcuts → Automation</div>
          Tap <span className="kbd">＋</span> (or <span className="kbd">New Automation</span>), scroll to the <em>Personal</em> section and choose <span className="kbd">Transaction</span>.
        </li>
        <li>
          <div className="k">Pick your cards</div>
          Under <em>Card</em>, select the Wallet cards to watch (leave Categories and Merchants as <em>Any</em>). Choose <span className="kbd">Run Immediately</span>, turn <em>Notify When Run</em> off, then tap <span className="kbd">Next</span> → <span className="kbd">New Blank Automation</span>.
        </li>
        <li>
          <div className="k">Add “Get Contents of URL”</div>
          Tap <span className="kbd">Add Action</span>, search for <em>Get Contents of URL</em> and add it. Tap the <em>URL</em> placeholder and paste your endpoint URL from above.
        </li>
        <li>
          <div className="k">Set method and key</div>
          Tap the <span className="kbd">›</span> arrow to expand. Set <em>Method</em> to <span className="kbd">POST</span>. Under <em>Headers</em>, tap <span className="kbd">Add new header</span>: Key <code>X-Api-Key</code>, Value = your key (copy it above).
        </li>
        <li>
          <div className="k">Build the JSON body</div>
          Set <em>Request Body</em> to <span className="kbd">JSON</span>, then <span className="kbd">Add new field → Text</span> four times:
          <div className="group" style={{ marginTop: 8, background: 'var(--fill)' }}>
            {[
              ['amount', 'Shortcut Input → Amount'],
              ['merchant', 'Shortcut Input → Merchant'],
              ['card', 'Shortcut Input → Card or Pass'],
              ['timestamp', 'Current Date (tap it → Date Format: ISO 8601)'],
            ].map(([k, v]) => (
              <div key={k} className="cell" style={{ fontSize: 15, minHeight: 36, padding: '6px 12px' }}>
                <code style={{ width: 86, flex: 'none' }}>{k}</code><span className="muted">{v}</span>
              </div>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>
            To insert a variable, tap the value field, choose <em>Shortcut Input</em> from the bar above the keyboard, then tap the inserted token and pick the property (Amount, Merchant, Card or Pass).
          </div>
        </li>
        <li>
          <div className="k">Done</div>
          Tap <span className="kbd">Done</span>. Your next Apple Pay tap shows up here within seconds — the “Last transaction received” indicator turns green.
        </li>
      </ol>

      <div className="section-title">Good to know</div>
      <div className="group" style={{ padding: '12px 16px', fontSize: 15 }}>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
          <li>Duplicates (same amount, merchant and card within 60 seconds) are ignored automatically.</li>
          <li>New card names from Wallet are flagged on the Cards tab so you can link them once.</li>
          <li>Merchants are auto-categorized; fix one and future ones follow.</li>
          <li>If you regenerate the key, paste the new one into the automation’s header.</li>
        </ul>
      </div>

      <div className="section-title">Test from a computer</div>
      <div className="code" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`curl -X POST ${endpoint} \\
  -H "X-Api-Key: <your key>" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"4.25","merchant":"Test Coffee","card":"${firstCard}","test":true}'`}
      </div>
    </div>
  );
}
