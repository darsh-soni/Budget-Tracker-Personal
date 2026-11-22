# Hosting Pocket Ledger on GitHub Pages + Supabase

The `site/` folder is a static version of the app (plain HTML/CSS/JS, no build step). GitHub Pages serves it,
and Supabase provides the database, email sign-in, and the endpoint the iOS Shortcut posts to.

```
iPhone Shortcut ──POST──▶ Supabase Edge Function "wallet" ──▶ Postgres (RLS)
                                                                 ▲
Safari / Home Screen app ──▶ GitHub Pages (site/) ──supabase-js──┘
```

Final URL: **https://darsh-soni.github.io/Budget-Tracker-Personal/**

## 1. Create the Supabase project (free)

1. Sign up at supabase.com and click **New project**. Pick a region close to you (e.g. *Canada (Central)*), set a database password and keep it somewhere safe.
2. When it's ready, open **SQL Editor → New query**, paste the whole of `supabase/migrations/0001_init.sql`, and click **Run**. You should see "Success. No rows returned".

## 2. Turn on email sign-in with a code

1. **Authentication → Sign In / Providers → Email**: make sure it's enabled.
2. **Authentication → Emails → Templates**. In both **Magic Link** and **Confirm signup**, add the code so you can type it into the app:
   ```html
   <h2>Your Pocket Ledger code</h2>
   <p>Enter this code in the app: <strong style="font-size:24px">{{ .Token }}</strong></p>
   ```
3. **Authentication → URL Configuration**: set **Site URL** to `https://darsh-soni.github.io/Budget-Tracker-Personal/` and add the same URL under **Redirect URLs**.

The built-in email sender allows only a few emails per hour. That's fine for one person; set up custom SMTP (Project Settings → Authentication) if you share the app.

## 3. Deploy the wallet function

**In the dashboard (no tools needed):**
1. **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `wallet`.
3. Replace the sample code with the contents of `supabase/functions/wallet/index.ts` and click **Deploy**.
4. Open the function's **Details / Settings** and turn **off** "Verify JWT" (sometimes "Enforce JWT verification"). Save. The Shortcut proves who you are with your `X-Api-Key`, not a Supabase login.

**Or with the CLI:** `supabase link --project-ref <ref>` then `supabase functions deploy wallet --no-verify-jwt`.

## 4. Connect the site to your project

1. **Project Settings → API** (or **API Keys**): copy the **Project URL** and the **anon** / **publishable** key.
2. Put them in `site/config.js`:
   ```js
   window.PL_CONFIG = {
     supabaseUrl: 'https://abcdefghijkl.supabase.co',
     supabaseAnonKey: 'eyJ…',   // or sb_publishable_…
   };
   ```
   These two values are designed to be public; row-level security keeps every user's data private.
   **Never** put the `service_role` / secret key in this file.

## 5. Publish on GitHub Pages

1. Merge this work into `main`.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` runs on every push to `main` that changes `site/`. Watch it under the **Actions** tab. When it's green, the site is live.

## 6. Set up your iPhone

1. Open **https://darsh-soni.github.io/Budget-Tracker-Personal/** in Safari.
2. **Share → Add to Home Screen**, then open it from the Home Screen.
3. Sign in with your email and the code you're sent.
4. **Settings → Cards**: add your cards using the names Apple Wallet shows.
5. **Settings → Connect Apple Wallet**: tap **Send test transaction**. It should show a green ✓.

## 7. The Shortcut (silent capture)

This version doesn't open anything when you pay. If you built the earlier "Open URLs" automation, delete it first.

1. **Shortcuts → Automation → ＋ → Transaction**. Choose your cards, **Run Immediately**, Notify When Run off, **Next → New Blank Automation**.
2. Add **Get Contents of URL** and paste the endpoint from *Connect Apple Wallet* (`https://<project>.supabase.co/functions/v1/wallet`).
3. Tap **›**: **Method** `POST`; **Headers → Add new header**: `X-Api-Key` = your key.
4. **Request Body: JSON**, then **Add new field → Text** three times:

   | Key | Value |
   |---|---|
   | `amount` | Shortcut Input → **Amount** |
   | `merchant` | Shortcut Input → **Merchant** |
   | `card` | Shortcut Input → **Card or Pass** |

5. **Done**. Pay with Apple Pay; the purchase appears in the app within a few seconds (it refreshes every 30 s while open, and whenever you switch back to it).

## What this version does and doesn't do

| Feature | Static site |
|---|---|
| Wallet capture, duplicate protection, card matching, auto-categorize | ✓ (in the Edge Function) |
| Cards, budgets, charts, search, CSV import/export, learned rules | ✓ |
| Email sign-in with a code | ✓ |
| Offline: opens with last-loaded data; manual entries queue and sync | ✓ |
| Budget alerts | In-app banners only (no push notifications yet) |
| Face ID passkeys | Not yet (needs extra server code) |

## Updating

Edit files in `site/` and push to `main`; GitHub Pages redeploys automatically. Users get the new version the next time they open the app online.
