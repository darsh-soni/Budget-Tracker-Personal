-- Pocket Ledger schema. Amounts are integer cents. Default currency CAD.
-- Run in the Supabase SQL editor or with `supabase db push`.

create extension if not exists pgcrypto;

-- ───────────────────────── users ─────────────────────────
create table public.users (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text,
  display_name     text,
  currency         text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  timezone         text not null default 'America/Toronto',
  -- Secret for the iOS Shortcut (X-Api-Key). Readable only by its owner (RLS).
  api_token        text not null unique
                   default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  last_wallet_at   timestamptz,
  created_at       timestamptz not null default now()
);

-- ───────────────────────── cards ─────────────────────────
create table public.cards (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users (id) on delete cascade,
  name                 text not null check (length(name) between 1 and 60),
  last4                text check (last4 ~ '^[0-9]{4}$'),
  color                text not null default '#2a78d6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  type                 text not null default 'credit' check (type in ('credit', 'debit')),
  monthly_limit_cents  bigint check (monthly_limit_cents >= 0),
  sort                 int not null default 0,
  archived             boolean not null default false,
  created_at           timestamptz not null default now()
);
create index cards_user_idx on public.cards (user_id);

-- Maps the "Card or Pass" name sent by Shortcuts to a saved card ("map unknown cards once").
create table public.card_aliases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  alias      text not null,
  card_id    uuid not null references public.cards (id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index card_aliases_user_alias_idx on public.card_aliases (user_id, lower(alias));

-- ───────────────────────── categories & budgets ─────────────────────────
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  name       text not null check (length(name) between 1 and 40),
  icon       text not null default '•',
  color      text not null default '#2a78d6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort       int not null default 0,
  is_fallback boolean not null default false,  -- "Other": used when no rule matches
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  category_id   uuid not null unique references public.categories (id) on delete cascade,
  amount_cents  bigint not null default 0 check (amount_cents >= 0),
  updated_at    timestamptz not null default now()
);
create index budgets_user_idx on public.budgets (user_id);

-- ───────────────────────── transactions ─────────────────────────
create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  amount_cents   bigint not null,               -- positive = spend, negative = refund
  currency       text not null default 'CAD',
  merchant       text not null check (length(merchant) between 1 and 200),
  merchant_key   text not null,                 -- normalised merchant, used for rules + dedupe
  card_id        uuid references public.cards (id) on delete set null,
  raw_card       text,                          -- card name exactly as Shortcuts sent it
  category_id    uuid references public.categories (id) on delete set null,
  occurred_at    timestamptz not null default now(),
  note           text check (length(note) <= 500),
  source         text not null default 'manual' check (source in ('wallet', 'manual', 'import')),
  client_id      uuid,                          -- idempotency key for queued offline entries
  created_at     timestamptz not null default now()
);
create index transactions_user_time_idx on public.transactions (user_id, occurred_at desc);
create index transactions_user_card_idx on public.transactions (user_id, card_id, occurred_at desc);
create index transactions_user_cat_idx  on public.transactions (user_id, category_id, occurred_at desc);
create index transactions_dedupe_idx    on public.transactions (user_id, amount_cents, merchant_key, occurred_at);
create unique index transactions_client_id_idx on public.transactions (user_id, client_id) where client_id is not null;

-- ───────────────────────── merchant rules ─────────────────────────
create table public.merchant_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  keyword      text not null check (keyword = lower(keyword) and length(keyword) between 2 and 100),
  category_id  uuid not null references public.categories (id) on delete cascade,
  source       text not null default 'user' check (source in ('default', 'user')),
  created_at   timestamptz not null default now(),
  unique (user_id, keyword)
);

-- ───────────────────────── push, passkeys, alerts ─────────────────────────
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table public.passkeys (
  id            text primary key,                -- credential ID (base64url)
  user_id       uuid not null references public.users (id) on delete cascade,
  public_key    text not null,                   -- base64url COSE key
  counter       bigint not null default 0,
  transports    text[],
  device_name   text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index passkeys_user_idx on public.passkeys (user_id);

create table public.webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  challenge   text not null,
  user_id     uuid references public.users (id) on delete cascade,
  kind        text not null check (kind in ('register', 'login')),
  expires_at  timestamptz not null default now() + interval '5 minutes'
);

create table public.budget_alerts (
  user_id    uuid not null references public.users (id) on delete cascade,
  kind       text not null check (kind in ('category', 'card')),
  ref_id     uuid not null,
  month      text not null,          -- YYYY-MM in the user's timezone
  threshold  int  not null,          -- 80 or 100
  sent_at    timestamptz not null default now(),
  primary key (user_id, kind, ref_id, month, threshold)
);

-- ───────────────────────── row level security ─────────────────────────
alter table public.users               enable row level security;
alter table public.cards               enable row level security;
alter table public.card_aliases        enable row level security;
alter table public.categories          enable row level security;
alter table public.budgets             enable row level security;
alter table public.transactions        enable row level security;
alter table public.merchant_rules      enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.passkeys            enable row level security;
alter table public.webauthn_challenges enable row level security;  -- service role only
alter table public.budget_alerts       enable row level security;  -- service role only

create policy "own row" on public.users for select using (id = auth.uid());
create policy "own row update" on public.users for update using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['cards','card_aliases','categories','budgets','transactions','merchant_rules','push_subscriptions'] loop
    execute format('create policy "owner all" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

create policy "own passkeys read" on public.passkeys for select using (user_id = auth.uid());
create policy "own passkeys delete" on public.passkeys for delete using (user_id = auth.uid());

-- Users may not rewrite their own api_token directly; regeneration goes through the RPC below.
revoke update on public.users from authenticated;
grant update (display_name, currency, timezone) on public.users to authenticated;

create or replace function public.regenerate_api_token()
returns text language plpgsql security definer set search_path = public as $$
declare tok text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.users set api_token = tok where id = auth.uid();
  return tok;
end $$;
revoke all on function public.regenerate_api_token() from public, anon;
grant execute on function public.regenerate_api_token() to authenticated;

-- ───────────────────────── duplicate-safe insert ─────────────────────────
-- Serialises concurrent inserts for the same (user, amount, merchant) with an advisory lock,
-- then rejects a row if the same amount + merchant + card exists within ±window seconds.
create or replace function public.insert_transaction_dedupe(
  p_user_id uuid, p_amount_cents bigint, p_currency text, p_merchant text, p_merchant_key text,
  p_card_id uuid, p_raw_card text, p_category_id uuid, p_occurred_at timestamptz,
  p_note text, p_source text, p_window_seconds int default 60
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare existing uuid; new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_amount_cents || ':' || p_merchant_key, 0));
  select id into existing from public.transactions
   where user_id = p_user_id
     and amount_cents = p_amount_cents
     and merchant_key = p_merchant_key
     and (card_id is not distinct from p_card_id)
     and (p_card_id is not null or lower(coalesce(raw_card, '')) = lower(coalesce(p_raw_card, '')))
     and occurred_at between p_occurred_at - make_interval(secs => p_window_seconds)
                         and p_occurred_at + make_interval(secs => p_window_seconds)
   limit 1;
  if existing is not null then
    return jsonb_build_object('duplicate', true, 'id', existing);
  end if;
  insert into public.transactions (user_id, amount_cents, currency, merchant, merchant_key, card_id, raw_card,
                                   category_id, occurred_at, note, source)
  values (p_user_id, p_amount_cents, p_currency, p_merchant, p_merchant_key, p_card_id, p_raw_card,
          p_category_id, p_occurred_at, p_note, p_source)
  returning id into new_id;
  return jsonb_build_object('duplicate', false, 'id', new_id);
end $$;
revoke all on function public.insert_transaction_dedupe from public, anon, authenticated;
grant execute on function public.insert_transaction_dedupe to service_role;

-- ───────────────────────── new-user seeding ─────────────────────────
create or replace function public.seed_user_defaults(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c_groc uuid; c_dine uuid; c_tran uuid; c_bill uuid; c_shop uuid; c_other uuid;
begin
  insert into categories (user_id, name, icon, color, sort) values (p_user, 'Groceries', '🛒', '#1baf7a', 1) returning id into c_groc;
  insert into categories (user_id, name, icon, color, sort) values (p_user, 'Dining',    '🍽️', '#eb6834', 2) returning id into c_dine;
  insert into categories (user_id, name, icon, color, sort) values (p_user, 'Transport', '🚇', '#2a78d6', 3) returning id into c_tran;
  insert into categories (user_id, name, icon, color, sort) values (p_user, 'Bills',     '🧾', '#6250d6', 4) returning id into c_bill;
  insert into categories (user_id, name, icon, color, sort) values (p_user, 'Shopping',  '🛍️', '#e87ba4', 5) returning id into c_shop;
  insert into categories (user_id, name, icon, color, sort, is_fallback) values (p_user, 'Other', '📦', '#8a8984', 6, true) returning id into c_other;

  insert into budgets (user_id, category_id, amount_cents) values
    (p_user, c_groc, 60000), (p_user, c_dine, 30000), (p_user, c_tran, 20000),
    (p_user, c_bill, 120000), (p_user, c_shop, 30000), (p_user, c_other, 20000);

  insert into merchant_rules (user_id, keyword, category_id, source)
  select p_user, k, c_groc, 'default' from unnest(array[
    'loblaws','no frills','metro','sobeys','safeway','freshco','food basics','costco','walmart','superstore',
    'farm boy','whole foods','t&t','longo','fortinos','zehrs','iga','maxi','provigo','save-on-foods','grocery','market'
  ]) k
  union all select p_user, k, c_dine, 'default' from unnest(array[
    'starbucks','tim hortons','mcdonald','uber eats','doordash','skipthedishes','a&w','subway','wendy','burger',
    'pizza','sushi','cafe','coffee','restaurant','bistro','bar','pub','grill','chipotle','popeyes','kfc','harvey',
    'second cup','pret','bakery','eatery','kitchen'
  ]) k
  union all select p_user, k, c_tran, 'default' from unnest(array[
    'uber','lyft','presto','ttc','go transit','opus','compass','stm','via rail','petro-canada','petro canada','esso',
    'shell','ultramar','pioneer','husky','parking','impark','green p','air canada','westjet','porter','car wash'
  ]) k
  union all select p_user, k, c_bill, 'default' from unnest(array[
    'rogers','bell canada','telus','fido','koodo','freedom mobile','virgin plus','public mobile','hydro','enbridge',
    'netflix','spotify','apple.com/bill','disney','crave','insurance','internet','utilities','icloud','youtube premium'
  ]) k
  union all select p_user, k, c_shop, 'default' from unnest(array[
    'amazon','best buy','canadian tire','winners','marshalls','homesense','ikea','apple store','indigo',
    'shoppers drug mart','sport chek','h&m','zara','uniqlo','dollarama','home depot','lululemon','simons',
    'aritzia','sephora','staples','structube'
  ]) k
  on conflict do nothing;
end $$;
revoke all on function public.seed_user_defaults from public, anon, authenticated;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict (id) do nothing;
  perform public.seed_user_defaults(new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
