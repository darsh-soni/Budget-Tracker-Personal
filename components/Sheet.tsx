'use client';
import { useEffect } from 'react';

export function Sheet({
  open, onClose, title, children, action,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grabber" />
        <div className="sheet-header">
          <button className="link-btn" onClick={onClose}>Cancel</button>
          <h2>{title}</h2>
          <div style={{ minWidth: 60, textAlign: 'right' }}>{action}</div>
        </div>
        {children}
      </div>
    </>
  );
}
