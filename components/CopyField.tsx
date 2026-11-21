'use client';
import { useState } from 'react';

export function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [reveal, setReveal] = useState(!secret);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span className="faint" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.02em', flex: 1 }}>{label}</span>
        {secret && <button className="link-btn" style={{ fontSize: 15 }} onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Show'}</button>}
        <button className="link-btn" style={{ fontSize: 15, fontWeight: 600 }} onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
      <div className="code">{reveal ? value : '•'.repeat(24) + value.slice(-4)}</div>
    </div>
  );
}
