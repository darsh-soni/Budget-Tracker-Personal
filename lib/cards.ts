/** Match a card name sent by the Shortcut ("Card or Pass") to a saved card. */

export interface CardLike {
  id: string;
  name: string;
  last4: string | null;
  archived?: boolean;
}
export interface AliasLike {
  alias: string;
  card_id: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function matchCard(raw: string | null | undefined, cards: CardLike[], aliases: AliasLike[]): string | null {
  if (!raw || !raw.trim()) return null;
  const r = norm(raw);
  const active = cards.filter((c) => !c.archived);

  // 1. alias saved when the user mapped this name before
  const alias = aliases.find((a) => norm(a.alias) === r);
  if (alias && cards.some((c) => c.id === alias.card_id)) return alias.card_id;

  // 2. exact name
  const exact = active.filter((c) => norm(c.name) === r);
  if (exact.length === 1) return exact[0].id;

  // 3. last four digits appear in the raw name, e.g. "Visa •••• 1234"
  const digits = raw.match(/\d{4}(?!.*\d{4})/)?.[0];
  if (digits) {
    const byLast4 = active.filter((c) => c.last4 === digits);
    if (byLast4.length === 1) return byLast4[0].id;
  }

  // 4. one name contains the other — only if unambiguous
  const fuzzy = active.filter((c) => {
    const n = norm(c.name);
    return n.length >= 3 && (r.includes(n) || n.includes(r));
  });
  if (fuzzy.length === 1) return fuzzy[0].id;

  return null;
}
