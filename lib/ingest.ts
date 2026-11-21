import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchCard, type AliasLike, type CardLike } from './cards';
import { categorize, merchantKey, type RuleLike } from './merchant';

export interface MatchContext {
  cards: CardLike[];
  aliases: AliasLike[];
  rules: RuleLike[];
  fallbackCategoryId: string | null;
  categoryIds: Set<string>;
  cardIds: Set<string>;
}

/** Load everything needed to match a card and categorise a merchant for one user. */
export async function loadMatchContext(db: SupabaseClient, userId: string): Promise<MatchContext> {
  const [cards, aliases, rules, categories] = await Promise.all([
    db.from('cards').select('id,name,last4,archived').eq('user_id', userId),
    db.from('card_aliases').select('alias,card_id').eq('user_id', userId),
    db.from('merchant_rules').select('keyword,category_id,source').eq('user_id', userId),
    db.from('categories').select('id,is_fallback').eq('user_id', userId),
  ]);
  const cats = (categories.data ?? []) as { id: string; is_fallback: boolean }[];
  const cardRows = (cards.data ?? []) as CardLike[];
  return {
    cards: cardRows,
    aliases: (aliases.data ?? []) as AliasLike[],
    rules: (rules.data ?? []) as RuleLike[],
    fallbackCategoryId: cats.find((c) => c.is_fallback)?.id ?? null,
    categoryIds: new Set(cats.map((c) => c.id)),
    cardIds: new Set(cardRows.map((c) => c.id)),
  };
}

export function resolveTransaction(
  ctx: MatchContext,
  input: { merchant: string; rawCard?: string | null; cardId?: string | null; categoryId?: string | null },
) {
  const card_id = input.cardId && ctx.cardIds.has(input.cardId) ? input.cardId : matchCard(input.rawCard, ctx.cards, ctx.aliases);
  const category_id =
    input.categoryId && ctx.categoryIds.has(input.categoryId)
      ? input.categoryId
      : categorize(input.merchant, ctx.rules) ?? ctx.fallbackCategoryId;
  return { card_id, category_id, merchant_key: merchantKey(input.merchant) };
}

export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
