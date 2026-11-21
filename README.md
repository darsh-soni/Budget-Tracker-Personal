# Pocket Ledger

A mobile-first budget tracker built as a Progressive Web App that feels native on iPhone. Apple Pay taps are
logged automatically through an iOS Shortcuts automation, organized by card and category, and checked against
monthly budgets with push alerts.

**Stack:** Next.js 15 (App Router, TypeScript) · Supabase (Postgres, Auth, RLS) · Web Push (VAPID) · WebAuthn passkeys · Vercel

## Features

**Capture**
- `POST /api/transactions` endpoint for the iOS Shortcuts **Transaction** automation, authenticated with a per-user `X-Api-Key` that you can regenerate in Settings.
- Duplicate protection: same amount + merchant + card within 60 seconds is rejected (enforced in Postgres with an advisory lock, so two concurrent requests can't both get through).
- In-app **Connect Apple Wallet** guide with copyable URL and key, a **Send test transaction** button, and a live "last received" indicator. See [docs/SHORTCUTS.md](docs/SHORTCUTS.md).
- Quick manual entry: tap **＋**, type the amount (keyboard opens immediately), tap a recent merchant, then **Add**.
- CSV import from bank statements with column mapping (single amount or debit/credit columns, date format, sign convention), a preview, and skipping of rows already captured from Wallet.

**Cards**
- Name, last 4, color, credit/debit, optional monthly limit, archive.
- Auto-matching of Wallet "Card or Pass" names. Unknown names show a banner so you can link them once (stored as an alias and back-filled).
- Swipeable card carousel with month-to-date spend, limit progress, and that card's transactions. An **All cards** slide shows a breakdown by card.

**Budgeting**
- Default categories (Groceries, Dining, Transport, Bills, Shopping, Other) with monthly budgets. You can add your own categories.
- Auto-categorization from ~200 Canadian merchant keyword rules. Fixing a category creates a learned rule, with an option to apply it to past transactions.
- Monthly view: spent / budget / left, daily spending chart, and per-category progress with 80% and over-budget states.
- Search and filter by merchant, card, category, and date range.

**iOS PWA**
- Manifest with `display: standalone`, theme color, 192/512/maskable icons, and a 180×180 `apple-touch-icon`.
- `apple-mobile-web-app-capable` and status-bar meta tags, plus `viewport-fit=cover` with `env(safe-area-inset-*)` padding.
- Bottom tab bar, touch targets of at least 44pt, no hover-only UI, `-apple-system` font, automatic light/dark mode.
- Inputs at 17px (no zoom on focus) and `inputmode="decimal"` for amounts.
- Service worker: cached app shell and data for offline viewing. Offline manual entries are queued with idempotency keys and synced when you're back online.
- Web Push budget alerts on iOS 16.4+ Home Screen apps, e.g. "82% of Dining budget used" or "Amex Cobalt limit exceeded". Each alert is sent once per threshold per month.
- Add-to-Home-Screen coach sheet for Safari users.

**Account & data**
- Email sign-in with a 6-digit code, which works inside the standalone app where magic links can't. Face ID via WebAuthn passkeys.
- Amounts stored as integer cents. CAD is the default currency.
- CSV export of transactions, cards, categories and budgets, and merchant rules.

## Project layout

```
app/
  page.tsx                 Cards dashboard (carousel, breakdown, transactions)
  activity/                Search & filter
  budget/                  Monthly budgets & charts
  settings/                Settings, cards, wallet guide, CSV import, rules
  login/                   Email code + passkey sign-in
  api/
    transactions/          POST (Shortcut or app), GET search, PATCH/DELETE by id
    bootstrap/             Month data for the dashboard
    cards/ budgets/ categories/ rules/ settings/ import/ export/ push/ passkeys/
components/                UI (tab bar, sheets, lists, charts)
lib/                       Shared logic: money, merchant rules, card matching, dates, CSV, alerts, WebAuthn
public/                    manifest, service worker, icons
supabase/migrations/       Database schema, RLS, functions, seed trigger
docs/SHORTCUTS.md          Exact Shortcuts automation config
tests/                     Unit tests for parsing / matching logic
```

### Database

| Table | Purpose |
|---|---|
| `users` | Profile per auth user: currency (default `CAD`), timezone, `api_token`, `last_wallet_at` |
| `cards` | Name, last4, color, type, `monthly_limit_cents`, archived |
| `card_aliases` | Wallet card name → card (the "map unknown cards once" memory) |
| `categories` / `budgets` | Categories and their monthly budget in cents |
| `transactions` | `amount_cents` (positive = spend, negative = refund), merchant, `merchant_key`, card, raw Wallet card name, category, source |
| `merchant_rules` | Keyword → category; `source` = `default` or `user` (learned) |
| `push_subscriptions`, `passkeys`, `webauthn_challenges`, `budget_alerts` | Push, passkeys, single-use challenges, sent-alert ledger |

Every table has row-level security. Users can read only their own rows and can't change their `api_token` directly (that goes through `regenerate_api_token()`). New sign-ups are seeded with categories, budgets, and rules by a trigger.

## Local setup

Prerequisites: Node 20+, a Supabase project (free tier is fine).

```bash
git clone <this repo> && cd Budget-Tracker-Personal
npm install
cp .env.example .env.local      # then fill it in (see below)
npm run vapid                   # prints VAPID keys for push → paste into .env.local
npm run dev                     # http://localhost:3000
```

### 1. Create the database

In the Supabase dashboard, open **SQL Editor**, paste the contents of `supabase/migrations/0001_init.sql`, and run it.
(With the Supabase CLI: `supabase link --project-ref <ref> && supabase db push`.)

### 2. Configure auth

- **Authentication → Providers → Email**: enabled.
- **Authentication → Email Templates**: in both **Magic Link** and **Confirm signup**, include the code so users can type it in the installed app:
  ```html
  <h2>Your Pocket Ledger code</h2>
  <p>Enter this code in the app: <strong style="font-size:24px">{{ .Token }}</strong></p>
  <p>Or <a href="{{ .ConfirmationURL }}">sign in with this link</a> (opens in Safari).</p>
  ```
- **Authentication → URL Configuration**: set **Site URL** to your app URL and add `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback`) to **Redirect URLs**.
- For real use, configure **custom SMTP** (Project Settings → Auth). The built-in sender is heavily rate-limited.

### 3. Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | Project URL (Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | `service_role` key. **Server only.** Used by the Shortcut endpoint, passkey sign-in, and push alerts. |
| `NEXT_PUBLIC_APP_URL` | ✓ | Public origin, no trailing slash (e.g. `https://ledger.example.com`). Sets the passkey RP ID and the URL shown in the Wallet guide. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | for push | From `npm run vapid` |
| `VAPID_PRIVATE_KEY` | for push | From `npm run vapid` |
| `VAPID_SUBJECT` | for push | `mailto:you@example.com` |

> Passkeys are bound to the domain in `NEXT_PUBLIC_APP_URL`. If you change domains later, users need to add their passkey again.
> Locally, passkeys work on `http://localhost`. To test on a phone, use an HTTPS tunnel and set `NEXT_PUBLIC_APP_URL` to the tunnel URL.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Node test runner): amount parsing, merchant rules, card matching, time zones, CSV |
| `npm run vapid` | Generate a Web Push key pair |
| `npm run icons` | Regenerate PNG icons from `public/icon.svg` (needs Playwright + Chromium) |

## Deploy (Vercel + Supabase)

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo. The framework is detected as Next.js, so no build settings are needed.
3. Add the environment variables from the table above (Production and Preview). Set `NEXT_PUBLIC_APP_URL` to your production domain.
4. Deploy. Then in Supabase **Auth → URL Configuration**, set Site URL and add `https://<domain>/auth/callback`.
5. On your iPhone, open the site in Safari, then tap **Share → Add to Home Screen**. Open the app from the Home Screen and sign in.
6. In the app, add your cards under **Settings → Cards** (use the same names Wallet shows).
7. Open **Settings → Connect Apple Wallet** and follow the steps (also in [docs/SHORTCUTS.md](docs/SHORTCUTS.md)). Tap **Send test transaction**.
8. Turn on **Settings → Budget alerts** (from the Home Screen app only; iOS 16.4+), then tap **Send test notification**.

### Security notes
- The Shortcut key is a random 256-bit token. It's stored in the `users` row, readable only by its owner via RLS, so the app can show it for copying. Regenerating it invalidates the old key immediately.
- The service-role key is used only in server routes, and only after the caller has been authenticated (API key, session, or verified passkey assertion).
- Passkey challenges are single-use, expire after 5 minutes, and are stored server-side.
- CSV exports neutralize spreadsheet formula injection.

## API reference (summary)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/transactions` | `X-Api-Key` | Wallet capture `{ amount, merchant, card, timestamp?, note?, test? }` |
| `POST /api/transactions` | session | Manual entry `{ amount_cents, merchant, card_id?, category_id?, occurred_at?, note?, client_id? }` |
| `GET /api/transactions?q&card&category&from&to&before` | session | Search, paged by `before` |
| `PATCH/DELETE /api/transactions/:id` | session | Edit (category change learns a rule; `apply_to_similar`) / delete |
| `GET /api/bootstrap?month=YYYY-MM` | session | Dashboard data |
| `POST /api/cards`, `PATCH/DELETE /api/cards/:id`, `POST /api/cards/aliases` | session | Cards & Wallet-name links |
| `PUT /api/budgets`, `POST/DELETE /api/categories`, `GET/POST/DELETE /api/rules` | session | Budgets, categories, rules |
| `POST /api/import` | session | CSV rows (mapped client-side), `dry_run` supported |
| `GET /api/export?table=transactions\|cards\|categories\|rules` | session | CSV download |
| `POST /api/settings/token` | session | Regenerate Shortcut key |
| `POST/DELETE /api/push/subscribe`, `POST /api/push/test` | session | Web Push |
| `/api/passkeys/{register,login}/{options,verify}` | session / public | WebAuthn |
