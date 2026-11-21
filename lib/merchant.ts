/** Merchant normalisation and keyword-rule categorisation. */

export interface RuleLike {
  keyword: string;
  category_id: string;
  source: 'default' | 'user';
}

/** Lowercase, strip accents and punctuation noise, collapse whitespace. */
export function normalizeMerchant(merchant: string): string {
  return merchant
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&'.\/+\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stable key for a merchant: normalised name without store numbers, card-terminal ids
 * and trailing location noise, e.g. "STARBUCKS #4521 TORONTO ON" → "starbucks toronto on".
 * Used for dedupe and for remembering user corrections.
 */
export function merchantKey(merchant: string): string {
  const key = normalizeMerchant(merchant)
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b(?:store|str|no)\.?\s*\d+\b/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\*+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key || normalizeMerchant(merchant) || merchant.toLowerCase().trim();
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `keyword` occurs in `text` on word boundaries. */
export function keywordMatches(text: string, keyword: string): boolean {
  const kw = keyword.trim();
  if (!kw) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(kw)}($|[^a-z0-9])`).test(text);
}

/**
 * Pick a category for a merchant. User rules (learned from corrections) beat defaults;
 * among equals, the longest (most specific) keyword wins.
 */
export function categorize(merchant: string, rules: RuleLike[]): string | null {
  const text = normalizeMerchant(merchant);
  const key = merchantKey(merchant);
  let best: RuleLike | null = null;
  for (const rule of rules) {
    if (!keywordMatches(text, rule.keyword) && !keywordMatches(key, rule.keyword)) continue;
    if (!best) { best = rule; continue; }
    const rank = (r: RuleLike) => (r.source === 'user' ? 1000 : 0) + r.keyword.length;
    if (rank(rule) > rank(best)) best = rule;
  }
  return best?.category_id ?? null;
}
