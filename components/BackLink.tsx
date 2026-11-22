'use client';
import Link from 'next/link';
import { IconChevronLeft } from './Icons';

export function BackLink({ href = '/settings', label = 'Settings', title }: { href?: string; label?: string; title?: string }) {
  return (
    <div className="nav-row" style={{ margin: '0 -8px' }}>
      <Link href={href} className="back"><IconChevronLeft />{label}</Link>
      {title && <div className="nav-title">{title}</div>}
      <span style={{ minWidth: 80 }} />
    </div>
  );
}
