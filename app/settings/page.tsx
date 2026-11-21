'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startRegistration } from '@simplewebauthn/browser';
import { useBootstrap, refreshAll } from '@/lib/client/data';
import { api } from '@/lib/client/api';
import { relativeTime } from '@/lib/client/format';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/client/push';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { useShell } from '@/components/AppShell';
import { Switch } from '@/components/Switch';
import { isIOS, isStandalone } from '@/components/InstallPrompt';

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];

export default function Settings() {
  const { data } = useBootstrap();
  const { toast } = useShell();
  const router = useRouter();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [canPush, setCanPush] = useState(true);
  const [standalone, setStandalone] = useState(true);

  useEffect(() => {
    setCanPush(pushSupported());
    setStandalone(isStandalone() || !isIOS());
    currentSubscription().then((s) => setPushOn(!!s)).catch(() => {});
  }, []);

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      if (on) { await enablePush(); setPushOn(true); toast('Budget alerts on'); }
      else { await disablePush(); setPushOn(false); }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }

  async function addPasskey() {
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/passkeys/register/options', { method: 'POST' });
      const response = await startRegistration({ optionsJSON });
      await api('/api/passkeys/register/verify', { body: { response, deviceName: /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : 'This device' } });
      toast('Face ID sign-in enabled');
      refreshAll();
    } catch (e) {
      const err = e as Error;
      if (err.name !== 'NotAllowedError') toast(err.message);
    }
  }

  async function setCurrency(currency: string) {
    try { await api('/api/settings', { method: 'PATCH', body: { currency } }); refreshAll(); } catch (e) { toast((e as Error).message); }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    navigator.serviceWorker?.controller?.postMessage('clear-user-cache');
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="page">
      <h1 className="large-title">Settings</h1>

      {!standalone && (
        <div className="banner info">
          <span style={{ fontSize: 22 }} aria-hidden>📲</span>
          <span>Add Pocket Ledger to your Home Screen (Share → Add to Home Screen) to enable notifications and full-screen mode.</span>
        </div>
      )}

      <div className="section-title">Capture</div>
      <div className="group">
        <Link href="/settings/wallet" className="cell chev">
          <span className="icon-badge" style={{ background: '#1c1c1e' }}>⚡️</span>
          <span className="label">Connect Apple Wallet</span>
          <span className="value" style={{ fontSize: 15 }}>{data?.user.last_wallet_at ? `Last ${relativeTime(data.user.last_wallet_at)}` : 'Not set up'}</span>
        </Link>
        <Link href="/settings/import" className="cell chev">
          <span className="icon-badge" style={{ background: '#1baf7a' }}>⇪</span>
          <span className="label">Import bank CSV</span>
        </Link>
      </div>

      <div className="section-title">Organize</div>
      <div className="group">
        <Link href="/settings/cards" className="cell chev">
          <span className="icon-badge" style={{ background: '#2a78d6' }}>💳</span>
          <span className="label">Cards</span>
          <span className="value">{data?.cards.filter((c) => !c.archived).length ?? ''}</span>
        </Link>
        <Link href="/budget" className="cell chev">
          <span className="icon-badge" style={{ background: '#eb6834' }}>🎯</span>
          <span className="label">Categories & budgets</span>
        </Link>
        <Link href="/settings/rules" className="cell chev">
          <span className="icon-badge" style={{ background: '#6250d6' }}>🏷️</span>
          <span className="label">Auto-categorize rules</span>
        </Link>
        <label className="cell">
          <span className="icon-badge" style={{ background: '#008300' }}>$</span>
          <span className="label">Currency</span>
          <select className="text" style={{ width: 'auto', textAlign: 'right', padding: '0 4px', color: 'var(--text-2)' }} value={data?.user.currency ?? 'CAD'} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <div className="section-title">Notifications</div>
      <div className="group">
        <div className="cell">
          <span className="icon-badge" style={{ background: '#e34948' }}>🔔</span>
          <span className="label">Budget alerts<div className="faint" style={{ fontSize: 13 }}>At 80% and 100% of a budget or card limit</div></span>
          <Switch checked={pushOn} onChange={(v) => !pushBusy && canPush && togglePush(v)} label="Budget alerts" />
        </div>
        {pushOn && (
          <button className="cell" onClick={() => api('/api/push/test', { method: 'POST' }).then(() => toast('Test sent')).catch((e) => toast(e.message))}>
            <span className="label" style={{ color: 'var(--accent)', paddingLeft: 42 }}>Send test notification</span>
          </button>
        )}
      </div>
      {!canPush && <p className="footnote">Requires iOS 16.4+ and the app opened from your Home Screen.</p>}

      <div className="section-title">Security</div>
      <div className="group">
        <button className="cell" onClick={addPasskey}>
          <span className="icon-badge" style={{ background: '#1baf7a' }}>🔐</span>
          <span className="label">{data?.passkeyCount ? 'Add another passkey' : 'Enable Face ID sign-in'}</span>
          <span className="value">{data?.passkeyCount ? `${data.passkeyCount} saved` : ''}</span>
        </button>
      </div>
      <p className="footnote">Signed in as {data?.user.email}</p>

      <div className="section-title">Your data</div>
      <div className="group">
        {[
          ['transactions', 'Export transactions'],
          ['cards', 'Export cards'],
          ['categories', 'Export categories & budgets'],
          ['rules', 'Export merchant rules'],
        ].map(([t, label]) => (
          <a key={t} className="cell chev" href={`/api/export?table=${t}`} download>
            <span className="label">{label}</span>
            <span className="value">CSV</span>
          </a>
        ))}
      </div>

      <div className="group" style={{ marginTop: 24 }}>
        <button className="cell" onClick={signOut}><span className="label" style={{ color: 'var(--bad)', textAlign: 'center' }}>Sign Out</span></button>
      </div>
    </div>
  );
}
