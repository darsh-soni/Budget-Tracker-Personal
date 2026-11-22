// Supabase Edge Function: receives Apple Wallet transactions from the iOS Shortcuts automation.
//
//   POST https://<project>.supabase.co/functions/v1/wallet
//   Header  X-Api-Key: <the user's key from Settings → Connect Apple Wallet>
//   Body    { "amount": "$6.45", "merchant": "Starbucks", "card": "Amex Cobalt", "timestamp"?: ISO, "note"?: "", "test"?: true }
//
// Deploy with JWT verification OFF (the Shortcut authenticates with X-Api-Key, not a Supabase login):
//   supabase functions deploy wallet --no-verify-jwt
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to Edge Functions automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-api-key, authorization, apikey',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ── parsing helpers (same rules as the app) ── */
function parseCents(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/[-−]/.test(s)) neg = true;
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const d = s.lastIndexOf('.'), c = s.lastIndexOf(',');
  let n: string;
  if (d === -1 && c === -1) n = s;
  else if (c > d) { const dec = s.length - c - 1; n = dec > 0 && dec <= 2 ? s.slice(0, c).replace(/[.,]/g, '') + '.' + s.slice(c + 1) : s.replace(/[.,]/g, ''); }
  else { const dec = s.length - d - 1; n = dec <= 2 ? s.slice(0, d).replace(/[.,]/g, '') + '.' + s.slice(d + 1) : s.replace(/[.,]/g, ''); }
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const cents = Math.round(v * 100);
  return neg ? -cents : cents;
}
const normM = (m: string) => m.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9&'.\/+\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
const mKey = (m: string) => normM(m).replace(/#\s*\d+/g, ' ').replace(/\b(?:store|str|no)\.?\s*\d+\b/g, ' ').replace(/\b\d{3,}\b/g, ' ').replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim() || normM(m) || m.toLowerCase().trim();
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kwRe = (t: string, k: string) => new RegExp('(^|[^a-z0-9])' + reEsc(k) + '($|[^a-z0-9])').test(t);
// Also compare with dashes, dots and apostrophes removed, so "Wal-Mart" matches "walmart".
const squash = (x: string) => x.replace(/[-'.]/g, '');
const kwHit = (t: string, k: string) => kwRe(t, k) || kwRe(squash(t), squash(k));
const normC = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function parseTime(input: unknown): Date | null {
  if (input == null || input === '') return null;
  if (typeof input === 'number') { const d = new Date(input < 1e12 ? input * 1000 : input); return isNaN(+d) ? null : d; }
  if (typeof input !== 'string') return null;
  let d = new Date(input.trim());
  if (!isNaN(+d)) return d;
  d = new Date(input.replace(/\s+at\s+/i, ' ').replace(/[  ]/g, ' '));
  return isNaN(+d) ? null : d;
}
const clean = (v: unknown, max: number) => (typeof v === 'string' && v.replace(/[\u0000-\u001f]/g, ' ').trim() ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const token = (req.headers.get('x-api-key') ?? '').trim();
  if (!token) return json({ error: 'Invalid API key: the X-Api-Key header is missing or empty.' }, 401);
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: `Invalid API key: expected 64 letters/digits, got ${token.length} characters. Copy the key again from the app.` }, 401);

  // Service key: legacy env var, or the newer secret key list if legacy keys are disabled.
  let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) { try { serviceKey = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string ?? ''; } catch { /* ignore */ } }
  if (!serviceKey) { console.error('no service key in env'); return json({ error: 'Server setup: no service key available to the function.' }, 500); }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
  const { data: user, error: userErr } = await db.from('users').select('id,currency').eq('api_token', token).maybeSingle();
  if (userErr) {
    console.error('users lookup failed', userErr);
    return json({ error: `Database error: ${userErr.message}. Has the setup SQL (0001_init.sql) been run?` }, 500);
  }
  if (!user) return json({ error: 'Invalid API key: no account has this key. Copy it again from the app (it changes if you tap Regenerate).' }, 401);

  let raw: Record<string, unknown>;
  try { raw = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return json({ error: 'Body must be a JSON object' }, 400);
  const body = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));

  const cents = parseCents(body.amount);
  if (!cents || Math.abs(cents) > 1_000_000_000) return json({ error: 'amount is missing or not a number', received: body.amount ?? null }, 422);
  const merchant = clean(body.merchant, 200);
  if (!merchant) return json({ error: 'merchant is required' }, 422);
  const rawCard = clean(body.card ?? body['card or pass'], 100);
  const t = parseTime(body.timestamp);
  const occurredAt = t && +t < Date.now() + 86_400_000 ? t : new Date();

  const [cards, aliases, rules, cats] = await Promise.all([
    db.from('cards').select('id,name,last4,archived').eq('user_id', user.id),
    db.from('card_aliases').select('alias,card_id').eq('user_id', user.id),
    db.from('merchant_rules').select('keyword,category_id,source').eq('user_id', user.id),
    db.from('categories').select('id,is_fallback').eq('user_id', user.id),
  ]);

  // card matching: saved alias → exact name → last 4 digits → unambiguous partial name
  let cardId: string | null = null;
  if (rawCard) {
    const r = normC(rawCard), all = cards.data ?? [], act = all.filter((c) => !c.archived);
    const al = (aliases.data ?? []).find((a) => normC(a.alias) === r);
    if (al && all.some((c) => c.id === al.card_id)) cardId = al.card_id;
    if (!cardId) { const ex = act.filter((c) => normC(c.name) === r); if (ex.length === 1) cardId = ex[0].id; }
    if (!cardId) { const d4 = rawCard.match(/\d{4}(?!.*\d{4})/)?.[0]; if (d4) { const l = act.filter((c) => c.last4 === d4); if (l.length === 1) cardId = l[0].id; } }
    if (!cardId) { const fz = act.filter((c) => { const n = normC(c.name); return n.length >= 3 && (r.includes(n) || n.includes(r)); }); if (fz.length === 1) cardId = fz[0].id; }
  }

  // categorize: user rules beat built-in ones; longest keyword wins
  const text = normM(merchant), key = mKey(merchant);
  let best: { keyword: string; category_id: string; source: string } | null = null, rank = -1;
  for (const rule of rules.data ?? []) {
    if (!kwHit(text, rule.keyword) && !kwHit(key, rule.keyword)) continue;
    const rk = (rule.source === 'user' ? 1000 : 0) + rule.keyword.length;
    if (rk > rank) { best = rule; rank = rk; }
  }
  const categoryId = best?.category_id ?? (cats.data ?? []).find((c) => c.is_fallback)?.id ?? null;

  if (body.test === true || body.test === 'true') {
    return json({ ok: true, test: true, message: 'Key accepted. Nothing was saved.', parsed: { amount_cents: cents, merchant, card: rawCard, card_matched: !!cardId, category_id: categoryId, occurred_at: occurredAt.toISOString() } });
  }

  const { data, error } = await db.rpc('insert_transaction_dedupe', {
    p_user_id: user.id, p_amount_cents: cents, p_currency: user.currency, p_merchant: merchant, p_merchant_key: key,
    p_card_id: cardId, p_raw_card: rawCard, p_category_id: categoryId, p_occurred_at: occurredAt.toISOString(),
    p_note: clean(body.note, 500), p_source: 'wallet', p_window_seconds: 60,
  });
  if (error) { console.error(error); return json({ error: 'Could not save transaction' }, 500); }
  if (data.duplicate) return json({ ok: false, duplicate: true, id: data.id, error: 'Duplicate transaction ignored' }, 409);

  await db.from('users').update({ last_wallet_at: new Date().toISOString() }).eq('id', user.id);
  return json({ ok: true, id: data.id, card_matched: !!cardId }, 201);
});
