'use client';
import { useEffect, useState } from 'react';
import { IconShare } from './Icons';

const KEY = 'pl-install-dismissed';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** "Add to Home Screen" coach mark for iOS Safari (iOS has no beforeinstallprompt). */
export function InstallPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isIOS() || isStandalone()) return;
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem(KEY) ?? 0); } catch {}
    if (Date.now() - dismissed < 14 * 86_400_000) return;
    const t = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch {}
    setShow(false);
  };
  return (
    <>
      <div className="sheet-backdrop" onClick={dismiss} />
      <div className="sheet" role="dialog" aria-label="Install app" style={{ paddingTop: 8 }}>
        <div className="sheet-grabber" />
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', margin: '16px 0' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/apple-touch-icon.png" width={60} height={60} alt="" style={{ borderRadius: 14 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 19 }}>Install Pocket Ledger</div>
            <div className="muted" style={{ fontSize: 15 }}>Full screen, Face ID sign-in and budget alerts.</div>
          </div>
        </div>
        <ol className="steps group">
          <li>Tap <span className="kbd"><IconShare /> Share</span> in Safari’s toolbar.</li>
          <li>Scroll and choose <span className="kbd">Add to Home Screen</span>.</li>
          <li>Tap <span className="kbd">Add</span>, then open the app from your Home Screen.</li>
        </ol>
        <button className="btn secondary" style={{ marginTop: 16 }} onClick={dismiss}>Not now</button>
      </div>
    </>
  );
}
