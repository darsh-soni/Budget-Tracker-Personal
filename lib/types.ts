export type CardType = 'credit' | 'debit';
export type TxSource = 'wallet' | 'manual' | 'import';

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  currency: string;
  timezone: string;
  api_token: string;
  last_wallet_at: string | null;
}

export interface Card {
  id: string;
  name: string;
  last4: string | null;
  color: string;
  type: CardType;
  monthly_limit_cents: number | null;
  sort: number;
  archived: boolean;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort: number;
  is_fallback: boolean;
}

export interface Budget {
  category_id: string;
  amount_cents: number;
}

export interface Transaction {
  id: string;
  amount_cents: number;
  currency: string;
  merchant: string;
  merchant_key: string;
  card_id: string | null;
  raw_card: string | null;
  category_id: string | null;
  occurred_at: string;
  note: string | null;
  source: TxSource;
  created_at: string;
}

export interface MerchantRule {
  id: string;
  keyword: string;
  category_id: string;
  source: 'default' | 'user';
}

export interface Bootstrap {
  user: UserProfile;
  month: string;
  cards: Card[];
  categories: Category[];
  budgets: Budget[];
  transactions: Transaction[];
  unknownCards: { raw_card: string; count: number }[];
  passkeyCount: number;
}
