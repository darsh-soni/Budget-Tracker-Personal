const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const IconHome = () => (
  <svg viewBox="0 0 24 24" aria-hidden><rect x="2.5" y="5" width="19" height="14" rx="3" {...p} /><path d="M2.5 9.5h19M6 15h4" {...p} /></svg>
);
export const IconList = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M8 6h13M8 12h13M8 18h13" {...p} /><circle cx="3.5" cy="6" r="1.2" fill="currentColor" /><circle cx="3.5" cy="12" r="1.2" fill="currentColor" /><circle cx="3.5" cy="18" r="1.2" fill="currentColor" /></svg>
);
export const IconPie = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a9 9 0 1 0 9 9h-9z" {...p} /><path d="M15 2.5A7 7 0 0 1 21.5 9H15z" {...p} /></svg>
);
export const IconGear = () => (
  <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="3" {...p} /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" {...p} /></svg>
);
export const IconPlus = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M12 5v14M5 12h14" {...p} strokeWidth={2.4} /></svg>
);
export const IconChevronLeft = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden><path d="M15 5l-7 7 7 7" {...p} strokeWidth={2.4} /></svg>
);
export const IconChevronRight = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden><path d="M9 5l7 7-7 7" {...p} strokeWidth={2.4} /></svg>
);
export const IconShare = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden style={{ verticalAlign: '-4px' }}><path d="M12 3v12M8 7l4-4 4 4" {...p} /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" {...p} /></svg>
);
