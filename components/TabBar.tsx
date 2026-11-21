'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconGear, IconHome, IconList, IconPie, IconPlus } from './Icons';

export function TabBar({ onAdd }: { onAdd: () => void }) {
  const path = usePathname();
  const tab = (href: string, label: string, Icon: () => React.JSX.Element) => {
    const active = href === '/' ? path === '/' : path.startsWith(href);
    return (
      <Link href={href} className="tab" aria-current={active ? 'page' : undefined}>
        <Icon />
        {label}
      </Link>
    );
  };
  return (
    <div className="tabbar">
      <nav aria-label="Main">
        {tab('/', 'Cards', IconHome)}
        {tab('/activity', 'Activity', IconList)}
        <button className="tab tab-add" onClick={onAdd} aria-label="Add expense">
          <span className="plus"><IconPlus /></span>
        </button>
        {tab('/budget', 'Budget', IconPie)}
        {tab('/settings', 'Settings', IconGear)}
      </nav>
    </div>
  );
}
