'use client';
import { IconChevronLeft, IconChevronRight } from './Icons';
import { currentMonthKey, monthLabel } from '@/lib/client/format';
import { shiftMonth } from '@/lib/dates';

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const isCurrent = month >= currentMonthKey();
  return (
    <div className="nav-row" style={{ margin: '0 -8px' }}>
      <button className="back" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}><IconChevronLeft /></button>
      <div className="nav-title">{monthLabel(month)}</div>
      <button className="back" aria-label="Next month" disabled={isCurrent} style={{ opacity: isCurrent ? 0.3 : 1, justifyContent: 'flex-end' }} onClick={() => onChange(shiftMonth(month, 1))}><IconChevronRight /></button>
    </div>
  );
}
