'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication } from '@simplewebauthn/browser';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { api } from '@/lib/client/api';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState(false);

  const done = () => { router.replace('/'); router.refresh(); };

  async function passkeyLogin(autofill = false) {
    try {
      const optionsJSON = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/passkeys/login/options', { method: 'POST' });
      const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
      setBusy(true);
      await api('/api/passkeys/login/verify', { body: { response } });
      done();
    } catch (e) {
      const err = e as Error;
      if (!autofill && err.name !== 'NotAllowedError' && err.name !== 'AbortError') setError(err.message);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    setPasskeys(true);
    // Offer saved passkeys in the email field's QuickType bar (conditional UI)
    browserSupportsWebAuthnAutofill().then((ok) => { if (ok) passkeyLogin(true); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) return setError(error.message);
    done();
  }

  return (
    <div className="page page-plain" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/apple-touch-icon.png" alt="" width={84} height={84} style={{ borderRadius: 20, boxShadow: '0 8px 24px rgba(0,0,0,.15)' }} />
        <h1 className="large-title" style={{ margin: '16px 0 4px' }}>Pocket Ledger</h1>
        <p className="muted" style={{ margin: 0 }}>Every Apple Pay tap, sorted by card and budget.</p>
      </div>

      {passkeys && step === 'email' && (
        <>
          <button className="btn" onClick={() => passkeyLogin(false)} disabled={busy}>Sign in with Face ID</button>
          <div className="faint" style={{ textAlign: 'center', margin: '18px 0', fontSize: 15 }}>or use your email</div>
        </>
      )}

      {step === 'email' ? (
        <form onSubmit={sendCode}>
          <div className="group">
            <input
              className="text"
              type="email"
              inputMode="email"
              autoComplete="username webauthn"
              autoCapitalize="none"
              placeholder="you@example.com"
              aria-label="Email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button className={`btn${passkeys ? ' secondary' : ''}`} style={{ marginTop: 12 }} disabled={busy || !email.includes('@')}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="muted" style={{ textAlign: 'center' }}>Enter the 6-digit code sent to <strong>{email}</strong>.</p>
          <div className="group">
            <input
              className="text"
              style={{ textAlign: 'center', fontSize: 28, letterSpacing: '0.3em' }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={10}
              aria-label="Code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button className="btn" style={{ marginTop: 12 }} disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Sign In'}</button>
          <button type="button" className="link-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => { setStep('email'); setCode(''); }}>Use a different email</button>
        </form>
      )}
      {error && <p role="alert" style={{ color: 'var(--bad)', textAlign: 'center' }}>{error}</p>}
      <p className="footnote" style={{ textAlign: 'center', marginTop: 24 }}>After signing in, add a passkey in Settings to use Face ID next time.</p>
    </div>
  );
}
