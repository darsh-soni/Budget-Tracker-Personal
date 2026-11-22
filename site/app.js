/* Pocket Ledger — static PWA for GitHub Pages, backed by Supabase.
   Data lives in Postgres tables protected by row-level security (supabase/migrations/0001_init.sql).
   Apple Wallet taps arrive through the `wallet` Edge Function (supabase/functions/wallet). */
(() => {
'use strict';

/* ───────────── setup ───────────── */
const CFG = window.PL_CONFIG || {};
const CONFIGURED = /^https:\/\/.+/.test(CFG.supabaseUrl || '') && (CFG.supabaseAnonKey || '').length > 20;
const sb = CONFIGURED ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
const WALLET_URL = CONFIGURED ? CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/wallet' : '';
const SWATCHES = ['#1c1c1e', '#007aff', '#34c759', '#ff9500', '#ff2d55', '#af52de', '#5856d6', '#ff3b30', '#30b0c7', '#a2845e', '#8e8e93', '#c7a046'];
const NO_CARD = '#8e8e93';
const STACK = 62; // px of each card visible in the Wallet stack
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ───────────── state ───────────── */
const S = {
  session: null, uid: null, email: '', ready: false, online: navigator.onLine, note: '',
  user: { currency: 'CAD', api_token: '', last_wallet_at: null },
  cards: [], cats: [], budgets: {}, rules: [], aliases: {},
  month: ymOf(new Date()), txByMonth: {},
  tab: 'cards', page: null, anim: '', selCard: null, pickedDay: null,
  search: { q: '', card: '', cat: '', from: '', to: '' }, activity: null, activityLoading: false,
  sheet: null, alert: null, showTok: false, imp: null, walletMsg: null,
  login: { step: LS.get('pl-seen-welcome', false) ? 'signin' : 'welcome', email: '', busy: false, error: '', info: '' },
};

/* ───────────── helpers ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID();
function ymOf(d) { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function shiftYm(ym, n) { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + n, 1)); }
function monthRange(ym) { const [y, m] = ym.split('-').map(Number); return { start: new Date(y, m - 1, 1).toISOString(), end: new Date(y, m, 1).toISOString() }; }
function monthName(ym, long = false) { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', ...(long || y !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); }
function money(c, o = {}) {
  const v = c / 100, noC = o.compact && (Number.isInteger(v) || Math.abs(v) >= 1000);
  try { return new Intl.NumberFormat('en-CA', { style: 'currency', currency: S.user.currency || 'CAD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: noC ? 0 : 2, maximumFractionDigits: noC ? 0 : 2, signDisplay: o.sign ? 'exceptZero' : 'auto' }).format(v); }
  catch { return '$' + v.toFixed(2); }
}
/** Large amount with a small currency sign and raised cents, Apple Card style. */
function moneyBig(c) {
  try {
    const parts = new Intl.NumberFormat('en-CA', { style: 'currency', currency: S.user.currency || 'CAD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 }).formatToParts(c / 100);
    let out = '';
    for (const p of parts) {
      if (p.type === 'currency') out += `<span class="cur">${esc(p.value)}</span>`;
      else if (p.type === 'decimal') out += `<span class="cents">${esc(p.value)}`;
      else if (p.type === 'fraction') out += `${esc(p.value)}</span>`;
      else out += esc(p.value);
    }
    return out;
  } catch { return esc(money(c)); }
}
function currencySymbol() { try { return new Intl.NumberFormat('en-CA', { style: 'currency', currency: S.user.currency || 'CAD', currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value || '$'; } catch { return '$'; } }
function parseCents(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  let s = input.trim(); if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/[-−]/.test(s) || /\bCR\b/i.test(s)) neg = true;
  s = s.replace(/[^0-9.,]/g, ''); if (!s) return null;
  const d = s.lastIndexOf('.'), c = s.lastIndexOf(',');
  let n;
  if (d === -1 && c === -1) n = s;
  else if (c > d) { const dec = s.length - c - 1; n = dec > 0 && dec <= 2 ? s.slice(0, c).replace(/[.,]/g, '') + '.' + s.slice(c + 1) : s.replace(/[.,]/g, ''); }
  else { const dec = s.length - d - 1; n = dec <= 2 ? s.slice(0, d).replace(/[.,]/g, '') + '.' + s.slice(d + 1) : s.replace(/[.,]/g, ''); }
  const v = Number(n); if (!Number.isFinite(v)) return null;
  const cents = Math.round(v * 100); return neg ? -cents : cents;
}
const decimal = (c) => (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + '.' + String(Math.abs(c) % 100).padStart(2, '0');
const normM = (m) => String(m).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9&'.\/+\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
const mKey = (m) => normM(m).replace(/#\s*\d+/g, ' ').replace(/\b(?:store|str|no)\.?\s*\d+\b/g, ' ').replace(/\b\d{3,}\b/g, ' ').replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim() || normM(m);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kwHit = (t, k) => new RegExp('(^|[^a-z0-9])' + reEsc(k) + '($|[^a-z0-9])').test(t);
const likeEsc = (s) => s.replace(/[%_\\]/g, (m) => '\\' + m);
function categorize(merchant) {
  const t = normM(merchant), key = mKey(merchant); let best = null, rank = -1;
  for (const r of S.rules) {
    if (!kwHit(t, r.k) && !kwHit(key, r.k)) continue;
    const rk = (r.s === 'user' ? 1000 : 0) + r.k.length;
    if (rk > rank) { best = r; rank = rk; }
  }
  return best ? best.c : (S.cats.find((c) => c.is_fallback)?.id ?? S.cats[0]?.id ?? null);
}
const normC = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function matchCard(raw, cards = S.cards) {
  if (!raw || !raw.trim()) return null;
  const r = normC(raw), act = cards.filter((c) => !c.archived);
  const al = S.aliases[r]; if (al && cards.some((c) => c.id === al)) return al;
  const ex = act.filter((c) => normC(c.name) === r); if (ex.length === 1) return ex[0].id;
  const d4 = raw.match(/\d{4}(?!.*\d{4})/)?.[0];
  if (d4) { const l = act.filter((c) => c.last4 === d4); if (l.length === 1) return l[0].id; }
  const fz = act.filter((c) => { const n = normC(c.name); return n.length >= 3 && (r.includes(n) || n.includes(r)); });
  return fz.length === 1 ? fz[0].id : null;
}
const catById = (id) => S.cats.find((c) => c.id === id);
const cardById = (id) => S.cards.find((c) => c.id === id);
const activeCards = () => S.cards.filter((c) => !c.archived);
function dayLabel(iso) {
  const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() === t.getFullYear() ? {} : { year: 'numeric' }) });
}
const timeLabel = (iso) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
function localInput(d) { d = new Date(d); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
const isNetErr = (e) => !navigator.onLine || e instanceof TypeError || /fetch|network|load failed/i.test(e?.message || '');
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const sw = (id, on, label) => `<label class="switch"><input type="checkbox" role="switch" id="${id}" aria-label="${esc(label)}" ${on ? 'checked' : ''}><span></span></label>`;

/* ───────────── SF-Symbols-style glyphs ───────────── */
function gearPath() {
  const pts = [], teeth = 8, ro = 9.6, ri = 7.4;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2, r = i % 4 < 2 ? ro : ri;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<path d="M${pts.join('L')}Z"/><circle cx="12" cy="12" r="3.2"/>`;
}
const G = {
  chevL: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevR: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  xmark: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5.5 12.5 4.2 4.2L18.5 7.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.6 4.6"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 9.6h19M6 15h4"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r="1.1" fill="currentColor" stroke="none"/>',
  pie: '<path d="M11 3.6a8.5 8.5 0 1 0 9.4 9.4H11z"/><path d="M14.2 2.8a7.2 7.2 0 0 1 7 7h-7z"/>',
  gear: gearPath(),
  cart: '<path d="M3 4h2.4l2.3 10.6a1.6 1.6 0 0 0 1.6 1.3h8.2a1.6 1.6 0 0 0 1.6-1.2L20.8 8H6.4"/><circle cx="10" cy="19.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="17" cy="19.6" r="1.25" fill="currentColor" stroke="none"/>',
  fork: '<path d="M5.5 3v5.5a2.5 2.5 0 0 0 5 0V3M8 11v10M8 3v5"/><path d="M17 21V3c2.4 1.2 3.4 4 3.4 7.2v2.8H17"/>',
  tram: '<rect x="5.5" y="3" width="13" height="14" rx="3.5"/><path d="M5.5 10.5h13M9 21l1.6-4M15 21l-1.6-4"/><circle cx="9" cy="13.8" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="13.8" r=".9" fill="currentColor" stroke="none"/>',
  doc: '<path d="M7.5 3h6.2L18 7.3V19a2 2 0 0 1-2 2H7.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M13.5 3v4.5H18M9 12.5h6M9 16h6"/>',
  bag: '<path d="M5 8.5h14l-.9 11a1.7 1.7 0 0 1-1.7 1.5H7.6a1.7 1.7 0 0 1-1.7-1.5z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  box: '<path d="M3.8 7.6 12 3.2l8.2 4.4v8.8L12 20.8l-8.2-4.4z"/><path d="M3.8 7.6 12 12l8.2-4.4M12 12v8.8M7.9 5.4l8.2 4.4"/>',
  bolt: '<path d="M13.4 2.5 5 13.6h6.2l-.8 7.9 8.6-11.3h-6.3z" fill="currentColor"/>',
  tray: '<path d="M4 13.5v4.8A1.7 1.7 0 0 0 5.7 20h12.6a1.7 1.7 0 0 0 1.7-1.7v-4.8"/><path d="M12 3.5v11M7.8 10.3 12 14.5l4.2-4.2"/>',
  share: '<path d="M12 14.5V3.5M7.8 7.7 12 3.5l4.2 4.2"/><path d="M8 10.5H6.7A1.7 1.7 0 0 0 5 12.2v7.1A1.7 1.7 0 0 0 6.7 21h10.6a1.7 1.7 0 0 0 1.7-1.7v-7.1a1.7 1.7 0 0 0-1.7-1.7H16"/>',
  tag: '<path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6l8.4 8.4a1.5 1.5 0 0 1 0 2.1l-6.5 6.5a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8.2" cy="8.2" r="1.4" fill="currentColor" stroke="none"/>',
  dollar: '<path d="M12 3v18M16.3 7.3C15.6 5.9 14 5 12 5c-2.4 0-4.3 1.3-4.3 3.3 0 4.6 9 2.6 9 7.2 0 2.1-1.9 3.5-4.5 3.5-2.2 0-3.9-1-4.6-2.6"/>',
  trash: '<path d="M4.5 6.8h15M9.3 6.8V4.6h5.4v2.2M6.5 6.8l.9 12.6a1.7 1.7 0 0 0 1.7 1.6h5.8a1.7 1.7 0 0 0 1.7-1.6l.9-12.6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  note: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  link: '<path d="M10.2 13.8a3.8 3.8 0 0 0 5.4 0l3.1-3.1a3.8 3.8 0 0 0-5.4-5.4l-1.1 1.1"/><path d="M13.8 10.2a3.8 3.8 0 0 0-5.4 0l-3.1 3.1a3.8 3.8 0 0 0 5.4 5.4l1.1-1.1"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>',
  del: '<path d="M9 5.5h10.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9L2.8 12z"/><path d="m12.5 9.5 5 5M17.5 9.5l-5 5"/>',
  warn: '<path d="M12 3.8 2.8 19.5h18.4z"/><path d="M12 10v4.3"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  checkc: '<circle cx="12" cy="12" r="9.2"/><path d="m8 12.3 2.8 2.8L16.2 9.6"/>',
  sparkle: '<path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5z" fill="currentColor"/><path d="M18.5 15.5c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z" fill="currentColor" stroke="none"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.5a9.3 9.3 0 0 1 12.4 0M9 16a4.6 4.6 0 0 1 6 0"/><circle cx="12" cy="19.2" r="1.1" fill="currentColor" stroke="none"/>',
};
function sym(name, size = 22, w = 1.9, style = '') {
  return `<svg class="sym" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${style ? ` style="${style}"` : ''}>${G[name] || ''}</svg>`;
}
// Built-in categories get system colors and symbols; custom ones keep their emoji and color.
const CAT_SYMBOL = { groceries: 'cart', dining: 'fork', transport: 'tram', bills: 'doc', shopping: 'bag', other: 'box' };
const SYS_COLOR = { '#1baf7a': '#34c759', '#eb6834': '#ff9500', '#2a78d6': '#007aff', '#6250d6': '#af52de', '#e87ba4': '#ff2d55', '#8a8984': '#8e8e93' };
const catColor = (c) => (c ? SYS_COLOR[String(c.color).toLowerCase()] || c.color : NO_CARD);
function catGlyph(c, size = 20) {
  if (!c) return sym('sparkle', size);
  const s = CAT_SYMBOL[c.name.toLowerCase()];
  return s ? sym(s, size, 2) : `<span style="font-size:${Math.round(size * .9)}px;line-height:1">${esc(c.icon)}</span>`;
}

/* ───────────── row mapping ───────────── */
const fromTx = (r) => ({ id: r.id, cents: Number(r.amount_cents), merchant: r.merchant, key: r.merchant_key, card: r.card_id, raw: r.raw_card, cat: r.category_id, at: r.occurred_at, note: r.note || '', src: r.source, client_id: r.client_id });
const toTx = (t) => ({ id: t.id, user_id: S.uid, amount_cents: t.cents, currency: S.user.currency, merchant: t.merchant, merchant_key: t.key, card_id: t.card || null, raw_card: t.raw || null, category_id: t.cat || null, occurred_at: t.at, note: t.note || null, source: t.src, client_id: t.client_id || null });
const fromCard = (r) => ({ id: r.id, name: r.name, last4: r.last4, color: r.color, type: r.type, limit: r.monthly_limit_cents == null ? null : Number(r.monthly_limit_cents), archived: r.archived, sort: r.sort });

/* ───────────── data loading ───────────── */
async function must(p) { const { data, error } = await p; if (error) throw error; return data; }
async function loadAll() {
  const [user, cards, cats, budgets, rules, aliases] = await Promise.all([
    must(sb.from('users').select('currency,api_token,last_wallet_at,email').eq('id', S.uid).single()),
    must(sb.from('cards').select('*').order('sort').order('created_at')),
    must(sb.from('categories').select('id,name,icon,color,sort,is_fallback').order('sort').order('name')),
    must(sb.from('budgets').select('category_id,amount_cents')),
    must(sb.from('merchant_rules').select('id,keyword,category_id,source')),
    must(sb.from('card_aliases').select('alias,card_id')),
  ]);
  S.user = user; S.cards = cards.map(fromCard); S.cats = cats;
  S.budgets = Object.fromEntries(budgets.map((b) => [b.category_id, Number(b.amount_cents)]));
  S.rules = rules.map((r) => ({ id: r.id, k: r.keyword, c: r.category_id, s: r.source }));
  S.aliases = Object.fromEntries(aliases.map((a) => [normC(a.alias), a.card_id]));
  await loadMonth(S.month);
}
async function loadMonth(ym) {
  const { start, end } = monthRange(ym);
  const rows = await must(sb.from('transactions').select('*').gte('occurred_at', start).lt('occurred_at', end).order('occurred_at', { ascending: false }).limit(2000));
  const pending = queue().filter((q) => ymOf(q.at) === ym && !rows.some((r) => r.client_id === q.client_id));
  S.txByMonth[ym] = [...pending, ...rows.map(fromTx)];
  snapshot();
}
async function refresh(quiet = true) {
  if (!S.uid || !navigator.onLine) return;
  try {
    const [user] = await Promise.all([must(sb.from('users').select('currency,api_token,last_wallet_at,email').eq('id', S.uid).single()), loadMonth(S.month)]);
    S.user = user; S.note = '';
    if (!S.sheet && !S.alert && !document.activeElement?.matches?.('input,select,textarea')) render(true);
  } catch (e) { if (!quiet) toast(errText(e), 'err'); }
}
function snapshot() { LS.set('pl-snapshot', { uid: S.uid, user: S.user, cards: S.cards, cats: S.cats, budgets: S.budgets, rules: S.rules, aliases: S.aliases, month: S.month, tx: S.txByMonth[S.month] || [] }); }
function restoreSnapshot() {
  const s = LS.get('pl-snapshot', null);
  if (!s || s.uid !== S.uid) return false;
  Object.assign(S, { user: s.user, cards: s.cards, cats: s.cats, budgets: s.budgets, rules: s.rules, aliases: s.aliases });
  S.txByMonth[s.month] = s.tx; S.month = s.month;
  return true;
}
function errText(e) { return isNetErr(e) ? 'You’re offline. Try again when you’re connected.' : e?.message || 'Something went wrong.'; }

/* ───────────── offline queue (manual entries) ───────────── */
const queue = () => LS.get('pl-queue', []);
function enqueue(t) { LS.set('pl-queue', [...queue().filter((q) => q.client_id !== t.client_id), t]); }
let flushing = false;
async function flushQueue() {
  if (flushing || !navigator.onLine || !S.uid) return;
  flushing = true; let n = 0;
  try {
    for (const t of queue()) {
      const { error } = await sb.from('transactions').insert(toTx(t));
      if (error && error.code !== '23505' && isNetErr(error)) break;
      LS.set('pl-queue', queue().filter((q) => q.client_id !== t.client_id));
      if (!error) n++;
    }
  } catch { /* still offline */ } finally { flushing = false; }
  if (n) { toast(`Synced ${n} offline ${n === 1 ? 'entry' : 'entries'}`); refresh(); }
}

/* ───────────── writes ───────────── */
function putLocal(tx, prevYm) {
  const ym = ymOf(tx.at);
  if (prevYm && S.txByMonth[prevYm]) S.txByMonth[prevYm] = S.txByMonth[prevYm].filter((t) => t.id !== tx.id);
  if (S.txByMonth[ym]) S.txByMonth[ym] = [tx, ...S.txByMonth[ym].filter((t) => t.id !== tx.id)];
  if (S.activity) S.activity = S.activity.map((t) => (t.id === tx.id ? tx : t));
}
async function insertTx(tx) {
  putLocal(tx); render(true);
  try { await must(sb.from('transactions').insert(toTx(tx))); snapshot(); }
  catch (e) {
    if (isNetErr(e)) { enqueue(tx); toast('Saved on this iPhone. It will sync when you’re online.', 'warn'); }
    else { S.txByMonth[ymOf(tx.at)] = (S.txByMonth[ymOf(tx.at)] || []).filter((t) => t.id !== tx.id); render(true); toast(errText(e), 'err'); }
  }
}
async function updateTx(tx, prevYm) {
  putLocal(tx, prevYm); render(true);
  const row = toTx(tx); delete row.id; delete row.user_id; delete row.client_id;
  try { await must(sb.from('transactions').update(row).eq('id', tx.id)); snapshot(); } catch (e) { toast(errText(e), 'err'); refresh(); }
}
async function deleteTx(tx) {
  const ym = ymOf(tx.at);
  if (S.txByMonth[ym]) S.txByMonth[ym] = S.txByMonth[ym].filter((t) => t.id !== tx.id);
  if (S.activity) S.activity = S.activity.filter((t) => t.id !== tx.id);
  LS.set('pl-queue', queue().filter((q) => q.id !== tx.id));
  render(true);
  try { await must(sb.from('transactions').delete().eq('id', tx.id)); snapshot(); } catch (e) { toast(errText(e), 'err'); refresh(); }
}

/* ───────────── budget alerts (shown in-app) ───────────── */
function checkAlerts(tx) {
  const ym = ymOf(tx.at), list = S.txByMonth[ym] || [], seen = LS.get('pl-alerts', {}), msgs = [];
  const test = (kind, id, label, limit, spent) => {
    if (!limit) return;
    const pct = spent / limit * 100, hit = pct >= 100 ? 100 : pct >= 80 ? 80 : 0, k = `${ym}:${kind}:${id}`;
    if (hit && (seen[k] || 0) < hit) { seen[k] = hit; msgs.push(hit === 100 ? `${label} exceeded by ${money(spent - limit)}` : `${Math.floor(pct)}% of ${label} used`); }
  };
  if (tx.cat) test('cat', tx.cat, `${catById(tx.cat)?.name} budget`, S.budgets[tx.cat] || 0, list.filter((t) => t.cat === tx.cat).reduce((s, t) => s + t.cents, 0));
  if (tx.card) { const c = cardById(tx.card); test('card', tx.card, `${c?.name} limit`, c?.limit || 0, list.filter((t) => t.card === tx.card).reduce((s, t) => s + t.cents, 0)); }
  if (msgs.length) { LS.set('pl-alerts', seen); setTimeout(() => toast(msgs.join(' · '), 'warn'), 1600); }
}

/* ───────────── toast & action sheet ───────────── */
let toastT;
function toast(msg, kind = 'ok') {
  const r = $('#toast-root');
  const [icon, color] = { ok: ['check', 'var(--green)'], warn: ['warn', 'var(--orange)'], err: ['warn', 'var(--red)'] }[kind] || ['check', 'var(--green)'];
  r.innerHTML = `<div class="toast glass"><span class="ti" style="background:${color}">${sym(icon, 16, 2.6)}</span><span>${esc(msg)}</span></div>`;
  clearTimeout(toastT);
  toastT = setTimeout(() => { r.firstChild?.classList.add('out'); setTimeout(() => (r.innerHTML = ''), 360); }, kind === 'ok' ? 2600 : 4400);
}
/** iOS-style action sheet. actions: [{ label, destructive, act }] */
function confirmSheet(title, message, actions) { S.alert = { title, message, actions }; renderAlert(); }
function renderAlert() {
  const root = $('#alert-root'), a = S.alert;
  if (!a) { root.innerHTML = ''; return; }
  root.innerHTML = `<div class="scrim" data-act="alertcancel"></div><div class="actions" role="alertdialog" aria-label="${esc(a.title)}"><div class="grp"><div class="msg"><b>${esc(a.title)}</b>${esc(a.message || '')}</div>${a.actions.map((x, i) => `<button data-act="alertdo" data-v="${i}" class="${x.destructive ? 'destructive' : ''}">${esc(x.label)}</button>`).join('')}</div><div class="grp"><button class="cancel" data-act="alertcancel">Cancel</button></div></div>`;
}

/* ───────────── shared view pieces ───────────── */
function navBar({ title = '', left = '', right = '', always = false } = {}) {
  return `<div class="nav-row"><div class="nav-side">${left}</div><div class="nav-title${always ? ' always' : ''}">${esc(title)}</div><div class="nav-side" style="justify-content:flex-end">${right}</div></div>`;
}
const gbtn = (icon, act, label, v = '', extra = '') => `<button class="gbtn glass" data-act="${act}" ${v !== '' ? `data-v="${esc(v)}"` : ''} aria-label="${esc(label)}">${sym(icon, 21, 2.1)}${extra}</button>`;
const gpill = (text, act, cls = '') => `<button class="gpill glass ${cls}" data-act="${act}">${esc(text)}</button>`;
const chevron = () => `<span class="chev">${sym('chevR', 16, 2.4)}</span>`;
function monthSwitch() {
  const cur = S.month >= ymOf(new Date());
  return `<div class="monthsw glass"><button data-act="month" data-v="-1" aria-label="Previous month">${sym('chevL', 18, 2.4)}</button><strong>${esc(monthName(S.month, true))}</strong><button data-act="month" data-v="1" aria-label="Next month" ${cur ? 'disabled' : ''}>${sym('chevR', 18, 2.4)}</button></div>`;
}
function statusNote() {
  const q = queue().length;
  if (!S.online) return `<div class="pillnote">${sym('wifi', 15, 2)} Offline · showing saved data${q ? ` · ${q} waiting to sync` : ''}</div>`;
  if (S.note) return `<div class="note warn"><span class="tile" style="background:var(--orange)">${sym('warn', 20, 2.2)}</span><span><strong>Something’s not right</strong><span class="d">${esc(S.note)}</span></span></div>`;
  return '';
}
function txRows(list, { showCard = true } = {}) {
  return list.map((t) => {
    const c = catById(t.cat), card = cardById(t.card), q = queue().some((x) => x.id === t.id);
    const first = showCard ? (card ? card.name : t.raw ? `${t.raw} · not linked` : 'No card') : (c?.name || 'Uncategorized');
    return `<button class="row" data-act="edit" data-v="${esc(t.id)}"><span class="txi" style="background:${esc(catColor(c))}">${catGlyph(c)}</span><span class="main"><div class="title ell">${esc(t.merchant)}</div><div class="subtitle ell">${esc(first)} · ${esc(timeLabel(t.at))}${q ? ' · <span class="pending">Waiting to sync</span>' : ''}</div></span><span class="tx-amt ${t.cents < 0 ? 'refund' : ''}">${esc(money(t.cents, { sign: t.cents < 0 }))}${t.src === 'wallet' ? '<small>Apple Pay</small>' : ''}</span></button>`;
  }).join('');
}
function txList(list, opts = {}) {
  if (!list.length) return `<div class="group"><div class="empty">${sym('list', 34, 1.6)}${esc(opts.empty || 'No transactions yet.')}</div></div>`;
  const groups = [];
  for (const t of [...list].sort((a, b) => b.at.localeCompare(a.at))) {
    const d = new Date(t.at).toDateString(); let g = groups[groups.length - 1];
    if (!g || g.d !== d) groups.push((g = { d, items: [], total: 0 }));
    g.items.push(t); g.total += t.cents;
  }
  return groups.map((g) => `<div class="day-h"><span>${esc(dayLabel(g.items[0].at))}</span><span class="num">${esc(money(g.total))}</span></div><div class="group tx">${txRows(g.items, opts)}</div>`).join('');
}
function findTx(id) { for (const l of [...Object.values(S.txByMonth), S.activity || []]) { const t = l.find((x) => x.id === id); if (t) return t; } return null; }
function unknownNotes() {
  const counts = {};
  for (const t of S.txByMonth[S.month] || []) if (!t.card && t.raw) { const k = t.raw.toLowerCase(); (counts[k] ||= { raw: t.raw, n: 0 }).n++; }
  return Object.values(counts).slice(0, 3).map((u) => `<button class="note" data-act="linkcard" data-v="${esc(u.raw)}"><span class="tile" style="background:var(--blue)">${sym('link', 20, 2.1)}</span><span style="flex:1;min-width:0"><strong class="ell">New card from Apple Wallet</strong><span class="d">“${esc(u.raw)}” · ${u.n} purchase${u.n === 1 ? '' : 's'}. Tap to link it.</span></span><span style="color:var(--label-3)">${sym('chevR', 18, 2.2)}</span></button>`).join('');
}
function installNote() {
  if (!isIOS() || standalone() || LS.get('pl-install-dismissed', 0) > Date.now() - 14 * 864e5) return '';
  return `<div class="note"><img src="icons/apple-touch-icon.png" alt="" width="40" height="40" style="border-radius:10px"><span style="flex:1;min-width:0"><strong>Add to Home Screen</strong><span class="d">Tap ${sym('share', 14, 2, 'display:inline;vertical-align:-2px')} Share, then Add to Home Screen.</span></span><button class="gbtn" data-act="dismissinstall" aria-label="Dismiss" style="width:32px;height:32px;background:var(--fill-3)">${sym('xmark', 14, 2.4)}</button></div>`;
}
function wcardHtml(c, i, spent, selected) {
  const pct = c.limit ? Math.min(100, spent / c.limit * 100) : 0;
  return `<button class="wcard${selected ? ' sel' : ''}" style="--i:${i};--c:${esc(c.color)}" data-act="selcard" data-v="${esc(c.id)}" aria-label="${esc(c.name)}, ${esc(money(spent))} this month">
    <div class="wc-top"><span class="wc-name">${esc(c.name)}</span><span class="wc-amt">${esc(money(spent))}</span></div>
    <div class="wc-chip" aria-hidden="true"></div>
    <div class="wc-bot"><div><div class="wc-lbl">${c.type === 'debit' ? 'Debit' : 'Credit'}${c.limit ? ` · ${esc(money(c.limit, { compact: true }))} limit` : ''}</div>${c.limit ? `<div class="wc-meter"><i style="width:${pct}%"></i></div>` : ''}</div><span class="wc-num">•••• ${esc(c.last4 || '····')}</span></div>
  </button>`;
}

/* ───────────── views ───────────── */
function viewCards() {
  const txs = S.txByMonth[S.month] || [], cards = activeCards();
  const byCard = new Map(); for (const t of txs) byCard.set(t.card || null, (byCard.get(t.card || null) || 0) + t.cents);
  const total = txs.reduce((s, t) => s + t.cents, 0);
  if (S.selCard && !cards.some((c) => c.id === S.selCard)) S.selCard = null;
  const sel = S.selCard ? cardById(S.selCard) : null;
  const totalBudget = S.cats.reduce((s, c) => s + (S.budgets[c.id] || 0), 0);
  let out = '';

  if (!sel) {
    out += `<h1 class="lt">Wallet</h1>${installNote()}${statusNote()}${monthSwitch()}`;
    if (!S.ready && !txs.length) out += `<div class="hero"><div class="skel" style="height:16px;width:40%"></div><div class="skel" style="height:44px;width:60%;margin-top:12px"></div><div class="skel" style="height:10px;margin-top:20px"></div></div>`;
    else {
      const byCat = new Map(); for (const t of txs) if (t.cents > 0) byCat.set(t.cat, (byCat.get(t.cat) || 0) + t.cents);
      const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
      out += `<section class="hero" aria-label="Spending this month"><div class="eyebrow">${esc(monthName(S.month))} Spending</div><div class="big">${moneyBig(total)}</div>
        <div class="hero-sub">${totalBudget ? `${Math.round(total / totalBudget * 100)}% of ${esc(money(totalBudget, { compact: true }))} budget · ` : ''}${txs.length} purchase${txs.length === 1 ? '' : 's'}</div>
        ${cats.length ? `<div class="catbar" role="img" aria-label="Spending by category">${cats.map(([id, v]) => `<i style="flex:${v} 1 0;background:${esc(catColor(catById(id)))}"></i>`).join('')}</div>
        <div class="legend">${cats.slice(0, 6).map(([id, v]) => { const c = catById(id); return `<div><span class="dot" style="background:${esc(catColor(c))}"></span><span class="nm">${esc(c?.name || 'Uncategorized')}</span><span class="am">${esc(money(v, { compact: true }))}</span></div>`; }).join('')}</div>` : ''}</section>`;
    }
    const un = unknownNotes(); if (un) out += `<div style="margin-top:14px">${un}</div>`;
    out += `<div class="sec-h">Cards${cards.length ? `<small>${cards.length}</small>` : ''}</div>`;
  } else {
    out += `<h1 class="lt" style="margin-bottom:4px">${esc(sel.name)}</h1><p class="lt-sub" style="margin:0 0 16px">${esc(monthName(S.month, true))}</p>`;
  }

  if (!cards.length) out += `<button class="wadd" data-act="newcard">${sym('plus', 30, 2.2)}Add a Card<small>Use the name Apple Wallet shows</small></button>`;
  else out += `<div class="wallet${sel ? ' is-sel' : ''}" id="wallet">${cards.map((c, i) => wcardHtml(c, i, byCard.get(c.id) || 0, sel?.id === c.id)).join('')}</div>`;

  if (sel) {
    const list = txs.filter((t) => t.card === sel.id), spent = list.reduce((s, t) => s + t.cents, 0);
    const pct = sel.limit ? spent / sel.limit * 100 : 0, over = sel.limit && spent > sel.limit;
    out += `<div class="card-detail"><div class="group" style="margin-top:18px"><div class="kpis"><div class="kpi"><div class="k">Spent</div><div class="v">${esc(money(spent, { compact: true }))}</div></div><div class="kpi"><div class="k">${sel.limit ? (over ? 'Over limit' : 'Left') : 'Limit'}</div><div class="v" style="${over ? 'color:var(--red)' : ''}">${sel.limit ? esc(money(Math.abs(sel.limit - spent), { compact: true })) : 'None'}</div></div><div class="kpi"><div class="k">Purchases</div><div class="v">${list.length}</div></div></div>
      ${sel.limit ? `<div style="padding:0 16px 16px"><div class="meter"><i style="width:${Math.min(100, pct)}%;background:${pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--orange)' : 'var(--green)'}"></i></div></div>` : ''}</div>
      <div class="sec-h">Latest Transactions</div>${txList(list, { showCard: false, empty: 'No purchases on this card this month.' })}
      <div class="group" style="margin-top:20px"><button class="row action" data-act="opencard" data-v="${esc(sel.id)}">${sym('card', 20, 2)}<span class="main">Card Details</span>${chevron()}</button></div></div>`;
  } else {
    if (!S.user.last_wallet_at && cards.length) out += `<button class="note" data-act="openpage" data-v="wallet" style="margin-top:18px"><span class="tile" style="background:#1c1c1e">${sym('bolt', 20)}</span><span style="flex:1"><strong>Log Apple Pay automatically</strong><span class="d">Set up the Shortcuts automation in about 2 minutes.</span></span><span style="color:var(--label-3)">${sym('chevR', 18, 2.2)}</span></button>`;
    out += `<div class="sec-h">Latest Transactions</div>${txList(txs.slice(0, 40), { empty: 'Nothing yet this month. Tap ＋ to add an expense.' })}`;
    if (txs.length > 40) out += `<div class="group" style="margin-top:14px"><button class="row action center" data-act="tab" data-v="activity">See All ${txs.length} Transactions</button></div>`;
  }
  return out;
}

let actTimer;
function runActivitySearch() {
  clearTimeout(actTimer);
  actTimer = setTimeout(async () => {
    const f = S.search;
    S.activityLoading = true;
    try {
      let q = sb.from('transactions').select('*').order('occurred_at', { ascending: false }).limit(300);
      if (f.q.trim()) q = q.ilike('merchant', `%${likeEsc(f.q.trim())}%`);
      if (f.card === 'none') q = q.is('card_id', null); else if (f.card) q = q.eq('card_id', f.card);
      if (f.cat) q = q.eq('category_id', f.cat);
      if (f.from) q = q.gte('occurred_at', new Date(f.from + 'T00:00').toISOString());
      if (f.to) q = q.lt('occurred_at', new Date(new Date(f.to + 'T00:00').getTime() + 864e5).toISOString());
      S.activity = (await must(q)).map(fromTx);
    } catch {
      S.activity = Object.values(S.txByMonth).flat().filter((t) => (!f.q || normM(t.merchant).includes(normM(f.q))) && (!f.card || (f.card === 'none' ? !t.card : t.card === f.card)) && (!f.cat || t.cat === f.cat));
    }
    S.activityLoading = false; if (S.tab === 'activity') render(true);
  }, 250);
}
function filterCount() { const f = S.search; return [f.card, f.cat, f.from || f.to].filter(Boolean).length; }
function viewActivity() {
  const f = S.search, list = S.activity || [], n = filterCount(), total = list.reduce((s, t) => s + t.cents, 0);
  return `<h1 class="lt">Activity</h1>${statusNote()}
  <label class="search">${sym('search', 18, 2.2)}<input id="q" type="search" placeholder="Search merchants" aria-label="Search merchants" value="${esc(f.q)}" enterkeyhint="search" autocomplete="off"></label>
  ${n ? `<div class="chips" style="margin-top:12px">${f.card ? `<button class="chip plain" aria-pressed="true" data-act="clearf" data-v="card">${esc(f.card === 'none' ? 'No card' : cardById(f.card)?.name || 'Card')} ✕</button>` : ''}${f.cat ? `<button class="chip plain" aria-pressed="true" data-act="clearf" data-v="cat">${esc(catById(f.cat)?.name || 'Category')} ✕</button>` : ''}${f.from || f.to ? `<button class="chip plain" aria-pressed="true" data-act="clearf" data-v="date">${esc(f.from || '…')} – ${esc(f.to || '…')} ✕</button>` : ''}</div>` : ''}
  <p class="foot" style="margin-top:12px">${S.activity === null || S.activityLoading ? 'Searching…' : `${list.length}${list.length === 300 ? '+' : ''} transaction${list.length === 1 ? '' : 's'} · ${esc(money(total))}`}</p>
  ${S.activity === null ? `<div class="group" style="margin-top:12px;padding:16px"><div class="skel" style="height:40px"></div><div class="skel" style="height:40px;margin-top:12px"></div></div>` : txList(list, { empty: f.q || n ? 'No matching transactions.' : 'No transactions yet.' })}`;
}

function ringSvg(pct, color) {
  const r = 58, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return `<svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="${r}" stroke="var(--fill-3)" stroke-width="16"/>${p > 0 ? `<circle class="prog" cx="70" cy="70" r="${r}" stroke="${color}" stroke-width="16" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"/>` : ''}</svg>`;
}
function viewBudget() {
  const txs = S.txByMonth[S.month] || [], b = S.budgets;
  const spent = {}; for (const t of txs) spent[t.cat || '_'] = (spent[t.cat || '_'] || 0) + t.cents;
  const totalB = S.cats.reduce((s, c) => s + (b[c.id] || 0), 0), totalS = txs.reduce((s, t) => s + t.cents, 0), left = totalB - totalS;
  const [y, m] = S.month.split('-').map(Number), dim = new Date(y, m, 0).getDate(), cur = S.month === ymOf(new Date()), today = new Date().getDate();
  const daily = Array(dim).fill(0); for (const t of txs) { const d = new Date(t.at); if (d.getMonth() + 1 === m) daily[d.getDate() - 1] += Math.max(0, t.cents); }
  const max = Math.max(1, ...daily), daysSoFar = cur ? today : dim, avg = daily.slice(0, daysSoFar).reduce((s, v) => s + v, 0) / Math.max(1, daysSoFar);
  const daysLeft = cur ? dim - today + 1 : 0, pd = S.pickedDay;
  const pct = totalB ? totalS / totalB : 0, col = pct >= 1 ? 'var(--red)' : pct >= .8 ? 'var(--orange)' : 'var(--green)';
  const status = !totalB ? '' : pct >= 1 ? `<span class="status" style="color:var(--red)">${sym('warn', 14, 2.4)} Over budget</span>` : pct >= .8 ? `<span class="status" style="color:var(--orange)">${sym('warn', 14, 2.4)} ${Math.round(pct * 100)}% used</span>` : `<span class="status" style="color:var(--green)">${sym('checkc', 14, 2.4)} On track</span>`;
  return `<h1 class="lt">Budget</h1>${statusNote()}${monthSwitch()}
  <div class="ring-card"><div class="ring">${ringSvg(pct, col)}<div class="center"><div class="k">${left < 0 ? 'Over' : 'Left'}</div><div class="v" style="${left < 0 ? 'color:var(--red)' : ''}">${esc(money(Math.abs(left), { compact: true }))}</div></div></div>
    <div class="stats"><div><div class="k">Spent</div><div class="v">${esc(money(totalS, { compact: true }))}</div></div><div><div class="k">Monthly budget</div><div class="v">${esc(money(totalB, { compact: true }))}</div></div>${status}</div></div>
  ${cur && left > 0 && daysLeft ? `<p class="foot">About ${esc(money(Math.floor(left / daysLeft)))} a day for the next ${daysLeft} day${daysLeft === 1 ? '' : 's'}.</p>` : ''}
  <div class="sec-h">Daily Spending</div>
  <div class="chart"><div class="chart-h"><strong>${esc(money(Math.round(avg)))} <span>average a day</span></strong><span>${esc(monthName(S.month))}</span></div>
    <div class="bars" role="img" aria-label="Spending per day">${avg > 0 ? `<div class="avg" style="bottom:${Math.min(100, avg / max * 100)}%"><span>avg</span></div>` : ''}${pd !== null && pd < dim ? `<span class="tip" style="left:${Math.min(85, Math.max(15, (pd + .5) / dim * 100))}%">${esc(new Date(y, m - 1, pd + 1).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }))} · ${esc(money(daily[pd]))}</span>` : ''}${daily.map((v, i) => `<button class="${cur && i + 1 > today ? 'future' : cur && i + 1 === today ? 'today' : ''}" data-act="day" data-v="${i}" aria-pressed="${pd === i}" aria-label="Day ${i + 1}: ${esc(money(v))}"><i style="height:${v / max * 100}%"></i></button>`).join('')}</div>
    <div class="axis"><span>1</span><span>${Math.ceil(dim / 2)}</span><span>${dim}</span></div></div>
  <div class="sec-h">Categories<button class="link" data-act="editbudgets" style="padding:0">Edit</button></div>
  <div class="group iconed">${S.cats.map((c) => {
    const sp = spent[c.id] || 0, bud = b[c.id] || 0, p = bud ? sp / bud * 100 : 0, over = bud > 0 && sp > bud, near = !over && p >= 80;
    return `<button class="row" data-act="catfilter" data-v="${esc(c.id)}" style="display:block;padding:12px 16px"><div style="display:flex;align-items:center;gap:12px"><span class="tile" style="background:${esc(catColor(c))}">${catGlyph(c, 18)}</span><span class="main"><div class="title">${esc(c.name)}</div></span><span class="tx-amt">${esc(money(sp))}</span></div>
      ${bud ? `<div style="padding-left:42px;margin-top:9px"><div class="meter"><i style="width:${Math.min(100, p)}%;background:${esc(catColor(c))}"></i></div><div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px"><span style="color:${over ? 'var(--red)' : near ? 'var(--orange)' : 'var(--label-2)'};font-weight:${over || near ? 600 : 400}">${over ? `${esc(money(sp - bud))} over` : near ? `${Math.round(p)}% used` : `${esc(money(bud - sp))} left`}</span><span class="muted num">of ${esc(money(bud, { compact: true }))}</span></div></div>` : `<div class="subtitle" style="padding-left:42px">No budget set</div>`}</button>`;
  }).join('')}${spent._ ? `<div class="row"><span class="tile" style="background:${NO_CARD}">${sym('sparkle', 18)}</span><span class="main title">Uncategorized</span><span class="tx-amt">${esc(money(spent._))}</span></div>` : ''}</div>`;
}

function settingsRow(icon, color, label, act, v = '', value = '') {
  return `<button class="row" data-act="${act}" ${v ? `data-v="${esc(v)}"` : ''}><span class="tile" style="background:${color}">${sym(icon, 18, 2.1)}</span><span class="main title">${esc(label)}</span>${value ? `<span class="value">${value}</span>` : ''}${chevron()}</button>`;
}
function viewSettings() {
  const initial = (S.email || '?').trim()[0]?.toUpperCase() || '?';
  const learned = S.rules.filter((r) => r.s === 'user').length;
  return `<h1 class="lt">Settings</h1>${statusNote()}
  <div class="group"><div class="profile"><span class="avatar">${esc(initial)}</span><span class="main" style="min-width:0"><div style="font-size:20px;font-weight:600" class="ell">${esc(S.email)}</div><div style="font-size:15px;color:var(--label-2);margin-top:2px">Pocket Ledger account</div></span></div></div>
  <div class="group iconed">
    ${settingsRow('bolt', '#1c1c1e', 'Apple Wallet', 'openpage', 'wallet', S.user.last_wallet_at ? esc(ago(S.user.last_wallet_at)) : 'Not set up')}
    ${settingsRow('tray', 'var(--green)', 'Import Bank CSV', 'openpage', 'import')}
  </div>
  <div class="group iconed">
    ${settingsRow('card', 'var(--blue)', 'Cards', 'openpage', 'cards', String(activeCards().length))}
    ${settingsRow('pie', 'var(--orange)', 'Categories & Budgets', 'editbudgets')}
    ${settingsRow('tag', 'var(--purple)', 'Auto-Categorize', 'openpage', 'rules', learned ? String(learned) : '')}
    <label class="row" for="currency"><span class="tile" style="background:var(--teal)">${sym('dollar', 18, 2.1)}</span><span class="main title">Currency</span><select id="currency" class="bare" style="flex:none;width:auto;text-align:right;color:var(--label-2);min-height:auto;direction:rtl">${['CAD', 'USD', 'EUR', 'GBP', 'AUD'].map((c) => `<option ${S.user.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>${chevron()}</label>
  </div>
  <div class="group iconed">${settingsRow('share', 'var(--gray)', 'Export Transactions', 'export', '', 'CSV')}</div>
  <div class="group"><button class="row destructive" data-act="signout">Sign Out</button></div>
  <p class="foot" style="text-align:center;margin-top:18px">Budget alerts appear at the top of the screen when a purchase passes 80% or 100% of a budget.</p>`;
}

/* settings pages (pushed) */
function pageCards() {
  return `<h1 class="lt">Cards</h1>${S.cards.length ? `<div class="group iconed">${S.cards.map((c) => `<button class="row" data-act="opencard" data-v="${esc(c.id)}" style="${c.archived ? 'opacity:.5' : ''}"><span class="thumb" style="--c:${esc(c.color)}"></span><span class="main"><div class="title ell">${esc(c.name)}${c.archived ? ' (archived)' : ''}</div><div class="subtitle">${c.type === 'credit' ? 'Credit' : 'Debit'}${c.last4 ? ` ·· ${esc(c.last4)}` : ''}${c.limit ? ` · ${esc(money(c.limit, { compact: true }))} limit` : ''}</div></span>${chevron()}</button>`).join('')}</div>` : `<div class="group"><div class="empty">${sym('card', 36, 1.6)}Add the cards you pay with.</div></div>`}
  <p class="foot">Name each card the way Apple Wallet does (for example “Amex Cobalt”) so purchases match automatically.</p>
  <button class="btn tinted" data-act="newcard" style="margin-top:20px">${sym('plus', 20, 2.4)} Add Card</button>`;
}
function pageWallet() {
  const tok = S.user.api_token || '', on = !!S.user.last_wallet_at, m = S.walletMsg;
  return `<div class="page-hero"><span class="tile" style="background:#1c1c1e">${sym('bolt', 36)}</span><h1>Apple Wallet</h1><p>A Shortcuts automation sends every Apple Pay tap here in the background. Nothing opens when you pay.</p>
    <span class="live ${on ? 'on' : ''}">${on ? `<i></i>Receiving · last purchase ${esc(ago(S.user.last_wallet_at))}` : 'Waiting for the first purchase'}</span></div>
  <div class="form-h">Endpoint</div>
  <div class="group"><div style="padding:12px 16px"><div class="code">${esc(WALLET_URL)}</div></div><button class="row action" data-act="copyurl">${sym('copy', 20, 2)}<span class="main">Copy URL</span></button></div>
  <div class="form-h">X-Api-Key</div>
  <div class="group"><div style="padding:12px 16px"><div class="code" id="tok">${esc(S.showTok ? tok : '•'.repeat(28) + tok.slice(-4))}</div></div>
    <button class="row action" data-act="copytok">${sym('copy', 20, 2)}<span class="main">Copy Key</span></button>
    <button class="row action" data-act="showtok">${sym('eye', 20, 2)}<span class="main">${S.showTok ? 'Hide Key' : 'Show Key'}</span></button>
    <button class="row" data-act="regen" style="color:var(--red)">${sym('refresh', 20, 2)}<span class="main">Regenerate Key</span></button></div>
  <div class="group" style="margin-top:20px"><button class="row action" data-act="testwallet">${sym('send', 20, 2)}<span class="main">Send Test Transaction</span></button></div>
  ${m ? `<p class="foot" style="color:${m.ok ? 'var(--green)' : 'var(--red)'};font-weight:600">${esc(m.text)}</p>` : '<p class="foot">The test uses your key exactly like the Shortcut does, but nothing is saved.</p>'}
  <div class="form-h">Only Apple Pay taps</div>
  <div class="group"><div class="row" style="align-items:flex-start;padding:14px 16px"><span class="tile" style="background:var(--orange)">${sym('warn', 18, 2.2)}</span><span class="main subtitle" style="font-size:15px;margin:0">Online purchases typed with a card number, card swipes and pre-authorized bills aren’t seen. Add them with ＋ or import a bank CSV.</span></div></div>
  <div class="sec-h">Set Up the Automation</div>
  <ol class="steps group">
    <li><b>Open Shortcuts → Automation</b>Tap <span class="kbd">＋</span>, then find <span class="kbd">Transaction</span> in the list (or search for it). Needs iOS 17 or later.</li>
    <li><b>Pick your cards</b>Select the cards to track, leave Category and Merchant as <em>Any</em>, choose <span class="kbd">Run Immediately</span>, then <span class="kbd">Next</span> → <span class="kbd">New Blank Automation</span>.</li>
    <li><b>Add “Get Contents of URL”</b>Search for it, add it, and paste the endpoint URL.</li>
    <li><b>Method and key</b>Tap <span class="kbd">›</span>. Method <span class="kbd">POST</span>. Headers → Add new header: <code>X-Api-Key</code> = your key.</li>
    <li><b>JSON body</b>Request Body <span class="kbd">JSON</span>, then add three Text fields: <code>amount</code> = Shortcut Input → Amount, <code>merchant</code> = Shortcut Input → Merchant, <code>card</code> = Shortcut Input → Card or Pass.</li>
    <li><b>Done</b>Your next Apple Pay tap appears here within seconds.</li>
  </ol>
  <p class="foot">Duplicates (same amount, merchant and card within 60 seconds) are ignored. New card names appear on the Wallet tab so you can link them once.</p>`;
}
function pageRules() {
  const mine = S.rules.filter((r) => r.s === 'user'), builtIn = S.rules.length - mine.length;
  return `<h1 class="lt">Auto-Categorize</h1><p class="lt-sub" style="margin-top:-6px">When a merchant name contains a keyword, it gets that category. Your rules win over the ${builtIn} built-in ones.</p>
  <div class="form-h">New rule</div>
  <div class="group"><label class="field"><span>Keyword</span><input id="rk" placeholder="farmers market" autocapitalize="none"></label><label class="field"><span>Category</span><select id="rc" class="r"><option value="">Choose</option>${S.cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label></div>
  <button class="btn" style="margin-top:16px" data-act="addrule">Add Rule</button>
  <div class="form-h">Your rules</div>
  <div class="group iconed">${mine.length ? mine.map((r) => { const c = catById(r.c); return `<div class="row"><span class="tile" style="background:${esc(catColor(c))}">${catGlyph(c, 18)}</span><span class="main"><div class="title ell">${esc(r.k)}</div><div class="subtitle">${esc(c?.name || '—')}</div></span><button class="gbtn" style="width:36px;height:36px;color:var(--red)" data-act="delrule" data-v="${esc(r.id)}" aria-label="Delete rule ${esc(r.k)}">${sym('trash', 18, 2)}</button></div>`; }).join('') : `<div class="empty">Change a transaction’s category and it’s remembered here.</div>`}</div>`;
}
function pageImport() {
  const s = S.imp;
  return `<div class="page-hero"><span class="tile" style="background:var(--green)">${sym('tray', 36, 2)}</span><h1>Import Bank CSV</h1><p>Download a CSV from your bank’s website. Rows already logged from Apple Pay are skipped.</p></div>
  <label class="btn ${s?.name ? 'gray' : ''}" for="csvfile" style="cursor:pointer">${s?.name ? esc(s.name) : 'Choose CSV File'}</label><input type="file" id="csvfile" accept=".csv,text/csv" hidden><div id="csvmap"></div>`;
}

/* ───────────── render ───────────── */
const PAGE_TITLES = { cards: 'Cards', wallet: 'Apple Wallet', rules: 'Auto-Categorize', import: 'Import CSV' };
function render(quiet = false) {
  const app = $('#app'), nav = $('#nav'), bar = $('#tabbar');
  if (!CONFIGURED) { bar.hidden = true; nav.innerHTML = ''; app.innerHTML = `<div class="welcome"><h1>Almost there</h1><p class="muted" style="text-align:center">Add your Supabase project URL and key to <code>config.js</code>, then reload.</p></div>`; return; }
  if (!S.session) { bar.hidden = true; nav.innerHTML = ''; app.innerHTML = viewLogin(); wireLogin(); return; }
  bar.hidden = false;
  $('#fab').innerHTML = sym('plus', 28, 2.6);
  const tab = (id, label, icon) => `<button class="tab" data-act="tab" data-v="${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${sym(icon, 25, S.tab === id ? 2.2 : 1.9)}${label}</button>`;
  $('#tabs').innerHTML = tab('cards', 'Wallet', 'card') + tab('activity', 'Activity', 'list') + tab('budget', 'Budget', 'pie') + tab('settings', 'Settings', 'gear');

  let html, navHtml;
  if (S.tab === 'settings' && S.page) {
    html = { cards: pageCards, wallet: pageWallet, rules: pageRules, import: pageImport }[S.page]();
    navHtml = navBar({ title: PAGE_TITLES[S.page], left: gbtn('chevL', 'back', 'Back to Settings'), right: S.page === 'cards' ? gbtn('plus', 'newcard', 'Add card') : '', always: S.page === 'wallet' || S.page === 'import' });
  } else if (S.tab === 'cards') {
    html = viewCards();
    navHtml = S.selCard
      ? navBar({ title: cardById(S.selCard)?.name || '', left: gbtn('chevL', 'selcard', 'Back to all cards', S.selCard), right: gpill('Details', 'opencard', 'blue').replace('data-act="opencard"', `data-act="opencard" data-v="${esc(S.selCard)}"`) })
      : navBar({ title: 'Wallet', right: gbtn('plus', 'newcard', 'Add card') });
  } else if (S.tab === 'activity') {
    html = viewActivity();
    const n = filterCount();
    navHtml = navBar({ title: 'Activity', right: gbtn('filter', 'filters', 'Filter', '', n ? `<span class="badge-dot">${n}</span>` : '') });
  } else if (S.tab === 'budget') {
    html = viewBudget(); navHtml = navBar({ title: 'Budget', right: gpill('Edit', 'editbudgets', 'blue') });
  } else { html = viewSettings(); navHtml = navBar({ title: 'Settings' }); }

  const qF = document.activeElement?.id === 'q', pos = qF ? document.activeElement.selectionStart : 0;
  nav.innerHTML = navHtml;
  app.innerHTML = html;
  if (!quiet && S.anim) { app.classList.remove('anim-fade', 'anim-push', 'anim-pop'); void app.offsetWidth; app.classList.add('anim-' + S.anim); }
  S.anim = '';
  if (qF) { const q = $('#q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch {} }
  sizeWallet();
  if (S.page === 'import') { $('#csvfile')?.addEventListener('change', (e) => readCsv(e.target.files?.[0])); if (S.imp?.rows) renderCsvMap(); }
  onScroll();
}
function sizeWallet() {
  const w = $('#wallet'); if (!w) return;
  const n = w.querySelectorAll('.wcard').length, h = w.clientWidth / 1.586;
  w.style.height = (w.classList.contains('is-sel') ? h : h + (n - 1) * STACK) + 'px';
}
function onScroll() { document.body.classList.toggle('scrolled', window.scrollY > 34); }
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', sizeWallet);

/* ───────────── welcome & sign-in ───────────── */
function viewLogin() {
  const L = S.login, busy = L.busy ? 'disabled' : '';
  if (L.step === 'welcome') return `<div class="welcome"><img class="app-icon" src="icons/apple-touch-icon.png" alt=""><h1>Welcome to Pocket Ledger</h1>
    <div class="feat">${sym('bolt', 34)}<div><b>Automatic</b><span>Apple Pay purchases are logged the moment you tap.</span></div></div>
    <div class="feat">${sym('card', 34, 1.8)}<div><b>Every card</b><span>See what each card has spent this month, at a glance.</span></div></div>
    <div class="feat">${sym('pie', 34, 1.8)}<div><b>Budgets</b><span>Know what’s left in every category before you spend it.</span></div></div>
    <button class="btn" style="margin-top:22px" data-act="loginstep" data-v="signup">Create Account</button><button class="link" style="width:100%;margin-top:6px" data-act="loginstep" data-v="signin">Sign In</button></div>`;
  const email = `<label class="field"><input id="lemail" type="email" inputmode="email" autocomplete="username" autocapitalize="none" placeholder="Email" aria-label="Email" required value="${esc(L.email)}"></label>`;
  const pw = (id, ac, ph) => `<label class="field"><input id="${id}" type="password" autocomplete="${ac}" placeholder="${ph}" aria-label="${ph}" required minlength="8"></label>`;
  const head = (t, p) => `<img class="app-icon" src="icons/apple-touch-icon.png" alt="" style="width:72px;height:72px;border-radius:17px"><h1 style="margin:18px 0 6px">${t}</h1><p class="muted" style="text-align:center;margin:0 0 24px">${p}</p>`;
  let body = '';
  if (L.step === 'signin') body = `${head('Sign In', 'Use the email and password for your Pocket Ledger account.')}<form id="signinf"><div class="group">${email}${pw('lpass', 'current-password', 'Password')}</div><button class="btn" style="margin-top:18px" ${busy}>${L.busy ? 'Signing In…' : 'Sign In'}</button></form>
    <button class="link" style="width:100%;margin-top:8px" data-act="loginstep" data-v="reset">Forgot Password?</button><button class="link" style="width:100%" data-act="loginstep" data-v="signup">Create Account</button>`;
  else if (L.step === 'signup') body = `${head('Create Account', 'Your ledger is private to this account.')}<form id="signupf"><div class="group">${email}${pw('lpass', 'new-password', 'Password (8+ characters)')}</div><button class="btn" style="margin-top:18px" ${busy}>${L.busy ? 'Creating…' : 'Continue'}</button></form>
    <button class="link" style="width:100%;margin-top:8px" data-act="loginstep" data-v="signin">I Already Have an Account</button>`;
  else if (L.step === 'reset') body = `${head('Reset Password', 'We’ll email you a link to choose a new password. Open it on this iPhone.')}<form id="resetf"><div class="group">${email}</div><button class="btn" style="margin-top:18px" ${busy}>${L.busy ? 'Sending…' : 'Send Link'}</button></form>
    <button class="link" style="width:100%;margin-top:8px" data-act="loginstep" data-v="signin">Back to Sign In</button>`;
  else if (L.step === 'newpass') body = `${head('New Password', 'Choose a new password for your account.')}<form id="newpassf"><div class="group">${pw('lnewpass', 'new-password', 'New password (8+ characters)')}</div><button class="btn" style="margin-top:18px" ${busy}>${L.busy ? 'Saving…' : 'Save Password'}</button></form>`;
  else if (L.step === 'checkemail') body = `<div style="color:var(--blue)">${sym('send', 56, 1.6, 'margin:0 auto')}</div><h1 style="margin:18px 0 8px">Check Your Email</h1><p class="muted" style="text-align:center;margin:0 0 24px">${esc(L.info)}</p><button class="btn" data-act="loginstep" data-v="signin">Sign In</button>`;
  return `<div class="welcome">${body}${L.error ? `<p class="err" role="alert">${esc(L.error)}</p>` : ''}</div>`;
}
function wireLogin() {
  // Read the form BEFORE re-rendering: render() rebuilds the inputs and would empty them.
  const go = (id, fn) => $(id)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = $('#lemail'); if (em) S.login.email = em.value.trim();
    const f = { pass: $('#lpass')?.value || '', newpass: $('#lnewpass')?.value || '' };
    Object.assign(S.login, { busy: true, error: '' }); render();
    try { await fn(f); } catch (err) { S.login.error = err?.message || 'Something went wrong.'; }
    S.login.busy = false; render();
  });
  const fail = (error) => { if (error) throw error; };
  go('#signinf', async (f) => {
    const { error } = await sb.auth.signInWithPassword({ email: S.login.email, password: f.pass });
    if (error && /confirm/i.test(error.message)) throw new Error('Confirm your email first: open the link we sent you, then sign in here.');
    fail(error);
  });
  go('#signupf', async (f) => {
    const { data, error } = await sb.auth.signUp({ email: S.login.email, password: f.pass, options: { emailRedirectTo: location.origin + location.pathname } });
    fail(error);
    if (!data.session) Object.assign(S.login, { step: 'checkemail', info: `We sent a link to ${S.login.email}. Open it (it may open in Safari, that’s fine), then come back and sign in with your password.` });
  });
  go('#resetf', async () => {
    const { error } = await sb.auth.resetPasswordForEmail(S.login.email, { redirectTo: location.origin + location.pathname });
    fail(error);
    Object.assign(S.login, { step: 'checkemail', info: `If ${S.login.email} has an account, a reset link is on its way. Open it on this iPhone to choose a new password.` });
  });
  go('#newpassf', async (f) => {
    const { error } = await sb.auth.updateUser({ password: f.newpass });
    fail(error);
    S.login.step = 'signin'; toast('Password updated');
    const { data } = await sb.auth.getSession(); if (data.session) await start(data.session);
  });
}

/* ───────────── sheets ───────────── */
function openSheet(s) {
  s.key = uuid(); S.sheet = s;
  document.documentElement.style.setProperty('--origin', (window.scrollY + innerHeight / 2) + 'px');
  document.body.classList.add('sheet-open');
  renderSheet();
}
let closeTimer;
function closeSheet() {
  const root = $('#sheet-root'), sheet = root.querySelector('.sheet');
  S.sheet = null; document.body.classList.remove('sheet-open');
  if (!sheet) { root.innerHTML = ''; return; }
  sheet.classList.add('closing'); root.querySelector('.scrim')?.classList.add('closing');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { if (!S.sheet) root.innerHTML = ''; }, 380);
}
function sheetFrame(title, body, { save = '', saveLabel = 'Save', canSave = true } = {}) {
  return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grab"></div>
    <div class="sheet-h"><button class="gbtn glass" data-act="close" aria-label="Close">${sym('xmark', 19, 2.3)}</button><h2>${esc(title)}</h2>${save ? `<button class="gbtn tint" data-act="${save}" aria-label="${esc(saveLabel)}" id="sheetsave" ${canSave ? '' : 'disabled'}>${sym('check', 21, 2.6)}</button>` : '<span></span>'}</div>${body}</div>`;
}
function renderSheet() {
  const root = $('#sheet-root'), s = S.sheet;
  if (!s) return;
  clearTimeout(closeTimer);
  root.innerHTML = SHEETS[s.type](s);
  SHEET_INIT[s.type]?.(s);
  wireDrag();
}
function wireDrag() {
  const sheet = $('#sheet-root .sheet'), scrim = $('#sheet-root .scrim'); if (!sheet) return;
  let y0 = null, dy = 0, t0 = 0;
  const down = (e) => { if (e.target.closest('button,input,select,textarea') || sheet.scrollTop > 0) return; y0 = e.clientY; t0 = Date.now(); dy = 0; sheet.classList.add('dragging'); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; if (scrim) scrim.style.opacity = String(1 - Math.min(1, dy / 400)); };
  const up = () => { if (y0 === null) return; sheet.classList.remove('dragging'); const v = dy / Math.max(1, Date.now() - t0); y0 = null; if (dy > 120 || (dy > 30 && v > .7)) closeSheet(); else { sheet.style.transform = ''; if (scrim) scrim.style.opacity = ''; } };
  for (const el of [sheet.querySelector('.sheet-grab'), sheet.querySelector('.sheet-h')]) {
    el?.addEventListener('pointerdown', down); el?.addEventListener('pointermove', move); el?.addEventListener('pointerup', up); el?.addEventListener('pointercancel', up);
  }
}
function wirePickers(root, s) {
  root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.pick; s[k] = b.dataset.v || null;
    root.querySelectorAll(`[data-pick="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.v || null) === s[k])));
    s.onPick?.(k);
  }));
}
const cardPicker = (sel, none = 'Cash') => `<div class="minicards">${activeCards().map((c) => `<button type="button" class="mc" data-pick="card" data-v="${esc(c.id)}" aria-pressed="${sel === c.id}"><span class="face" style="--c:${esc(c.color)}"></span><span>${esc(c.name)}</span></button>`).join('')}<button type="button" class="mc" data-pick="card" data-v="" aria-pressed="${!sel}"><span class="face cash">${sym('dollar', 20, 2)}</span><span>${none}</span></button></div>`;
const catPicker = (sel, auto) => `<div class="chips">${auto ? `<button type="button" class="chip" data-pick="cat" data-v="" aria-pressed="${!sel}"><span class="ci" style="background:var(--indigo)">${sym('sparkle', 15)}</span>Automatic</button>` : ''}${S.cats.map((c) => `<button type="button" class="chip" data-pick="cat" data-v="${esc(c.id)}" aria-pressed="${sel === c.id}"><span class="ci" style="background:${esc(catColor(c))}">${catGlyph(c, 15)}</span>${esc(c.name)}</button>`).join('')}</div>`;
function copy(text) {
  const done = () => toast('Copied');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  function fallback() { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch { toast('Select the text and copy it.', 'warn'); } ta.remove(); }
}
const fieldIcon = (name) => sym(name, 20, 2, 'color:var(--label-2)');

const SHEETS = {
  add(s) {
    const counts = new Map();
    for (const t of Object.values(S.txByMonth).flat()) { const e = counts.get(t.key) || { m: t.merchant, n: 0, cat: t.cat }; e.n++; counts.set(t.key, e); }
    const recent = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    return sheetFrame('New Expense', `
      <div class="amount-display"><div class="v empty" id="amtv">${esc(currencySymbol())}0</div><button type="button" class="c more" data-act="adddetails" id="whenbtn">${esc(S.user.currency)} · Now · Add Date or Note</button></div>
      <div class="group" style="margin-top:10px"><label class="field">${fieldIcon('bag')}<input id="merch" placeholder="Merchant" aria-label="Merchant" autocapitalize="words" autocomplete="off" enterkeyhint="done"></label></div>
      <div class="group" id="adddetails" hidden style="margin-top:10px"><label class="field">${fieldIcon('calendar')}<input id="when" type="datetime-local" value="${localInput(new Date())}" aria-label="Date and time"></label><label class="field">${fieldIcon('note')}<input id="note" placeholder="Note" maxlength="500" aria-label="Note"></label></div>
      ${recent.length ? `<div class="chips" style="margin-top:10px">${recent.map((r) => `<button type="button" class="chip plain" data-recent="${esc(r.m)}" data-cat="${esc(r.cat || '')}">${esc(r.m)}</button>`).join('')}</div>` : ''}
      <div style="margin-top:10px" aria-label="Card">${cardPicker(s.card)}</div>
      <div style="margin-top:4px" aria-label="Category">${catPicker(s.cat, true)}</div>
      <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => `<button type="button" data-key="${k}" aria-label="${k === 'del' ? 'Delete' : k}">${k === 'del' ? sym('del', 24, 1.9) : k}</button>`).join('')}</div>`, { save: 'submitadd', saveLabel: 'Add expense', canSave: false });
  },
  edit(s) {
    const t = s.tx, c = catById(s.cat);
    return sheetFrame('Transaction', `
      <div class="detail-hero"><span class="txi" id="ehico" style="background:${esc(catColor(c))}">${catGlyph(c, 30)}</span>
        <div class="amt-edit"><span class="cur">${esc(currencySymbol())}</span><input class="big-input" id="eamt" inputmode="decimal" aria-label="Amount" value="${esc(decimal(t.cents))}" size="${decimal(t.cents).length}"></div>
        <input class="mid-input" id="emerch" aria-label="Merchant" value="${esc(t.merchant)}">
        <div class="when">${t.src === 'wallet' ? 'Apple Pay' : t.src === 'import' ? 'Imported' : 'Added by you'}${t.raw && !t.card ? ` · Wallet card “${esc(t.raw)}”` : ''}</div></div>
      <div class="group"><label class="field"><span>Date</span><input id="ewhen" type="datetime-local" class="r" value="${localInput(t.at)}"></label><label class="field"><span>Note</span><input id="enote" class="r" value="${esc(t.note || '')}" placeholder="None" maxlength="500"></label></div>
      <p class="foot">Use a negative amount for a refund.</p>
      <div class="form-h" style="margin-top:18px">Category</div>${catPicker(s.cat)}
      <div class="group" id="simrow" style="margin-top:14px" hidden><div class="row"><span class="main"><div class="title">Apply to all “${esc(t.merchant)}”</div><div class="subtitle">Future purchases here use this category either way.</div></span>${sw('esim', true, 'Apply to similar transactions')}</div></div>
      <div class="form-h" style="margin-top:14px">Card</div>${cardPicker(s.card, 'None')}
      <div class="group" style="margin-top:24px"><button class="row destructive" data-act="deltx">Delete Transaction</button></div>`, { save: 'saveedit' });
  },
  card(s) {
    const d = s.d;
    return sheetFrame(d.id ? 'Card Details' : 'New Card', `
      <div style="max-width:340px;margin:2px auto 18px"><div class="wcard" id="cprev" style="position:relative;--i:0;--c:${esc(d.color)};transform:none"><div class="wc-top"><span class="wc-name" id="cpn">${esc(d.name || 'Card Name')}</span></div><div class="wc-chip"></div><div class="wc-bot"><div class="wc-lbl" id="cpt">${d.type === 'debit' ? 'Debit' : 'Credit'}</div><span class="wc-num" id="cpl">•••• ${esc(d.last4 || '····')}</span></div></div></div>
      ${s.alias ? `<p class="foot" style="margin:0 16px 12px">Apple Wallet purchases from “${esc(s.alias)}” will be linked to this card.</p>` : ''}
      <div class="group"><label class="field"><span>Name</span><input id="cname" class="r" value="${esc(d.name)}" placeholder="Amex Cobalt"></label><label class="field"><span>Last 4</span><input id="clast" class="r" inputmode="numeric" maxlength="4" value="${esc(d.last4 || '')}" placeholder="Optional"></label><label class="field"><span>Monthly limit</span><input id="climit" class="r" inputmode="decimal" value="${d.limit ? esc(decimal(d.limit)) : ''}" placeholder="None"></label></div>
      <div class="form-h">Type</div><div class="seg"><button type="button" data-ctype="credit" aria-pressed="${d.type === 'credit'}">Credit</button><button type="button" data-ctype="debit" aria-pressed="${d.type === 'debit'}">Debit</button></div>
      <div class="form-h">Color</div><div class="group"><div class="swatches">${SWATCHES.map((c) => `<button type="button" class="swatch" data-color="${c}" aria-label="Color ${c}" aria-pressed="${d.color === c}" style="background:${c};--c:${c}">${d.color === c ? sym('check', 18, 2.8) : ''}</button>`).join('')}</div></div>
      ${d.id ? `<div class="group" style="margin-top:20px"><div class="row"><span class="main"><div class="title">Archived</div><div class="subtitle">Hide from Wallet and quick entry</div></span>${sw('carch', d.archived, 'Archived')}</div></div><div class="group" style="margin-top:20px"><button class="row destructive" data-act="delcard">Delete Card</button></div>` : ''}`, { save: 'savecard' });
  },
  linkcard(s) {
    return sheetFrame('Link Card', `<div class="page-hero" style="padding-top:0"><span class="tile" style="background:var(--blue);width:56px;height:56px;border-radius:14px">${sym('link', 28, 2)}</span><p>Apple Wallet calls this card <b style="color:var(--label)">“${esc(s.alias)}”</b>. Which of your cards is it? You’ll only be asked once.</p></div>
      ${activeCards().length ? `<div class="group iconed">${activeCards().map((c) => `<button class="row" data-act="dolink" data-v="${esc(c.id)}"><span class="thumb" style="--c:${esc(c.color)}"></span><span class="main title">${esc(c.name)}${c.last4 ? ` ·· ${esc(c.last4)}` : ''}</span>${chevron()}</button>`).join('')}</div>` : ''}
      <button class="btn tinted" style="margin-top:20px" data-act="newcardalias">${sym('plus', 20, 2.4)} New Card</button>`);
  },
  budgets() {
    return sheetFrame('Budgets', `<div class="group iconed">${S.cats.map((c) => `<label class="field" for="b-${esc(c.id)}"><span class="tile" style="background:${esc(catColor(c))};width:30px">${catGlyph(c, 18)}</span><span style="flex:1;width:auto" class="ell">${esc(c.name)}</span><input id="b-${esc(c.id)}" data-bud="${esc(c.id)}" class="r" inputmode="decimal" style="max-width:120px" value="${esc(decimal(S.budgets[c.id] || 0))}"></label>`).join('')}</div>
      <p class="foot">Monthly amounts. They repeat every month, and you’ll see an alert at 80% and 100%.</p>
      <div class="form-h">New category</div><div class="group"><label class="field"><span>Name</span><input id="ncname" class="r" placeholder="Pets"></label><label class="field"><span>Emoji</span><input id="ncicon" class="r" placeholder="🐶" maxlength="4"></label><label class="field"><span>Budget</span><input id="ncbud" class="r" inputmode="decimal" placeholder="0.00"></label></div>`, { save: 'savebudgets' });
  },
  filters() {
    const f = S.search;
    return sheetFrame('Filter', `<div class="form-h" style="margin-top:6px">Card</div><div class="chips wrap"><button class="chip plain" data-f="card" data-v="" aria-pressed="${!f.card}">Any Card</button>${S.cards.map((c) => `<button class="chip" data-f="card" data-v="${esc(c.id)}" aria-pressed="${f.card === c.id}"><span class="thumb" style="--c:${esc(c.color)};width:30px;border-radius:4px"></span>${esc(c.name)}</button>`).join('')}<button class="chip plain" data-f="card" data-v="none" aria-pressed="${f.card === 'none'}">No Card</button></div>
      <div class="form-h">Category</div><div class="chips wrap"><button class="chip plain" data-f="cat" data-v="" aria-pressed="${!f.cat}">Any Category</button>${S.cats.map((c) => `<button class="chip" data-f="cat" data-v="${esc(c.id)}" aria-pressed="${f.cat === c.id}"><span class="ci" style="background:${esc(catColor(c))}">${catGlyph(c, 15)}</span>${esc(c.name)}</button>`).join('')}</div>
      <div class="form-h">Dates</div><div class="group"><label class="field"><span>From</span><input id="ffrom" type="date" class="r" value="${esc(f.from)}"></label><label class="field"><span>To</span><input id="fto" type="date" class="r" value="${esc(f.to)}"></label></div>
      <div class="group" style="margin-top:20px"><button class="row action center" data-act="resetf">Reset Filters</button></div>`, { save: 'close', saveLabel: 'Done' });
  },
};

function amtDisplay(s, ev) {
  const v = $('#amtv'); if (!v) return;
  v.textContent = currencySymbol() + (s.amt || '0');
  v.classList.toggle('empty', !s.amt);
  if (ev === 'bump' || ev === 'shake') { v.classList.remove('bump', 'shake'); void v.offsetWidth; v.classList.add(ev); setTimeout(() => v.classList.remove(ev), 360); }
  updateAddSave(s);
}
function keyIn(s, k) {
  let a = s.amt || '';
  if (k === 'del') a = a.slice(0, -1);
  else if (k === '.') { if (a.includes('.')) return amtDisplay(s, 'shake'); a = (a || '0') + '.'; }
  else {
    if (a.includes('.') && a.split('.')[1].length >= 2) return amtDisplay(s, 'shake');
    if (!a.includes('.') && a.replace(/^0+/, '').length >= 7) return amtDisplay(s, 'shake');
    a = a === '0' ? k : a + k;
  }
  s.amt = a; amtDisplay(s, k === 'del' ? '' : 'bump');
}
function updateAddSave(s) { const b = $('#sheetsave'); if (b) b.disabled = !(parseCents(s.amt || '') > 0 && ($('#merch')?.value || '').trim()); }

const SHEET_INIT = {
  add(s) {
    const root = $('#sheet-root'), merch = $('#merch');
    s.amt = '';
    root.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => keyIn(s, b.dataset.key)));
    merch.addEventListener('input', () => updateAddSave(s));
    $('#when').addEventListener('change', (e) => { const d = new Date(e.target.value); if (!isNaN(d)) $('#whenbtn').textContent = `${S.user.currency} · ${dayLabel(d.toISOString())}, ${timeLabel(d.toISOString())}`; });
    merch.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); merch.blur(); } });
    root.querySelectorAll('[data-recent]').forEach((b) => b.addEventListener('click', () => {
      merch.value = b.dataset.recent;
      if (b.dataset.cat) { s.cat = b.dataset.cat; root.querySelectorAll('[data-pick="cat"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === s.cat))); }
      updateAddSave(s);
    }));
    wirePickers(root, s);
  },
  edit(s) {
    $('#eamt').addEventListener('input', (e) => { e.target.size = Math.max(3, e.target.value.length); });
    s.onPick = (k) => {
      if (k !== 'cat') return;
      $('#simrow').hidden = !(s.cat && s.cat !== s.tx.cat);
      const c = catById(s.cat), ico = $('#ehico'); ico.style.background = catColor(c); ico.innerHTML = catGlyph(c, 30);
    };
    wirePickers($('#sheet-root'), s);
  },
  card(s) {
    const root = $('#sheet-root'), d = s.d;
    $('#cname').addEventListener('input', (e) => { d.name = e.target.value; $('#cpn').textContent = d.name || 'Card Name'; });
    $('#clast').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); d.last4 = e.target.value; $('#cpl').textContent = '•••• ' + (d.last4 || '····'); });
    root.querySelectorAll('[data-ctype]').forEach((b) => b.addEventListener('click', () => { d.type = b.dataset.ctype; root.querySelectorAll('[data-ctype]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#cpt').textContent = d.type === 'debit' ? 'Debit' : 'Credit'; }));
    root.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
      d.color = b.dataset.color;
      root.querySelectorAll('[data-color]').forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.innerHTML = x === b ? sym('check', 18, 2.8) : ''; });
      $('#cprev').style.setProperty('--c', d.color);
    }));
  },
  filters() {
    const root = $('#sheet-root');
    root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { S.search[b.dataset.f] = b.dataset.v; root.querySelectorAll(`[data-f="${b.dataset.f}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); runActivitySearch(); render(true); }));
    $('#ffrom').addEventListener('change', (e) => { S.search.from = e.target.value; runActivitySearch(); render(true); });
    $('#fto').addEventListener('change', (e) => { S.search.to = e.target.value; runActivitySearch(); render(true); });
  },
};

/* ───────────── actions ───────────── */
function submitAdd() {
  const s = S.sheet, cents = parseCents(s.amt || ''), merchant = ($('#merch')?.value || '').trim();
  if (!(cents > 0)) return amtDisplay(s, 'shake');
  if (!merchant) { $('#merch').focus(); return; }
  const at = $('#when').value ? new Date($('#when').value).toISOString() : new Date().toISOString();
  const id = uuid();
  const tx = { id, client_id: id, cents, merchant, key: mKey(merchant), card: s.card || null, raw: null, cat: s.cat || categorize(merchant), at, note: $('#note').value.trim(), src: 'manual' };
  if (s.card) LS.set('pl-last-card', s.card);
  closeSheet(); insertTx(tx); toast(`${money(cents)} at ${merchant}`); checkAlerts(tx);
}
async function saveEdit() {
  const s = S.sheet, t = s.tx, cents = parseCents($('#eamt').value), merchant = $('#emerch').value.trim();
  if (!cents || !merchant) return toast('Enter an amount and a merchant.', 'warn');
  const at = $('#ewhen').value ? new Date($('#ewhen').value).toISOString() : t.at;
  const next = { ...t, cents, merchant, key: mKey(merchant), card: s.card || null, cat: s.cat, at, note: $('#enote').value.trim() };
  const changedCat = s.cat && s.cat !== t.cat, similar = changedCat && $('#esim')?.checked;
  closeSheet(); await updateTx(next, ymOf(t.at));
  if (!changedCat) return toast('Saved');
  let msg = 'Saved';
  try {
    const k = next.key.slice(0, 100);
    if (k.length >= 2) {
      const row = await must(sb.from('merchant_rules').upsert({ user_id: S.uid, keyword: k, category_id: s.cat, source: 'user' }, { onConflict: 'user_id,keyword' }).select().single());
      S.rules = [{ id: row.id, k, c: s.cat, s: 'user' }, ...S.rules.filter((r) => r.k !== k)];
      msg = `${merchant} will be ${catById(s.cat)?.name} from now on`;
    }
    if (similar) {
      const upd = await must(sb.from('transactions').update({ category_id: s.cat }).eq('merchant_key', next.key).neq('id', t.id).select('id'));
      if (upd.length) { msg += ` · ${upd.length} more updated`; await loadMonth(S.month); if (S.tab === 'activity') runActivitySearch(); }
    }
  } catch (e) { msg = 'Saved, but the rule could not be stored: ' + errText(e); }
  render(true); toast(msg);
}
async function saveCard() {
  const s = S.sheet, d = s.d;
  d.name = $('#cname').value.trim(); d.last4 = $('#clast').value.trim() || null;
  if (!d.name) return toast('Give the card a name.', 'warn');
  if (d.last4 && !/^\d{4}$/.test(d.last4)) return toast('Last 4 must be four digits.', 'warn');
  const lim = $('#climit').value.trim(); d.limit = lim ? Math.max(0, parseCents(lim) || 0) : null;
  if ($('#carch')) d.archived = $('#carch').checked;
  const row = { name: d.name.slice(0, 60), last4: d.last4, color: d.color, type: d.type, monthly_limit_cents: d.limit, archived: !!d.archived };
  try {
    let saved;
    if (d.id) saved = await must(sb.from('cards').update(row).eq('id', d.id).select().single());
    else saved = await must(sb.from('cards').insert({ ...row, user_id: S.uid, sort: S.cards.length }).select().single());
    const card = fromCard(saved);
    S.cards = d.id ? S.cards.map((c) => (c.id === card.id ? card : c)) : [...S.cards, card];
    let attached = 0;
    if (s.alias) attached += await linkAlias(s.alias, card.id);
    if (!d.id) {
      const orphans = await must(sb.from('transactions').select('id,raw_card').is('card_id', null).not('raw_card', 'is', null).limit(1000));
      const ids = orphans.filter((t) => matchCard(t.raw_card) === card.id).map((t) => t.id);
      if (ids.length) { await must(sb.from('transactions').update({ card_id: card.id }).in('id', ids)); attached += ids.length; }
    }
    closeSheet(); if (attached) await loadMonth(S.month); render(true);
    toast(d.id ? 'Card saved' : `${card.name} added${attached ? ` · ${attached} purchase${attached === 1 ? '' : 's'} linked` : ''}`);
  } catch (e) { toast(errText(e), 'err'); }
}
async function linkAlias(alias, cardId) {
  await must(sb.from('card_aliases').delete().ilike('alias', likeEsc(alias)));
  await must(sb.from('card_aliases').insert({ user_id: S.uid, alias, card_id: cardId }));
  S.aliases[normC(alias)] = cardId;
  const upd = await must(sb.from('transactions').update({ card_id: cardId }).is('card_id', null).ilike('raw_card', likeEsc(alias)).select('id'));
  return upd.length;
}
async function doLink(cardId) {
  const alias = S.sheet.alias;
  try { const n = await linkAlias(alias, cardId); closeSheet(); await loadMonth(S.month); render(true); toast(`Linked “${alias}” · ${n} purchase${n === 1 ? '' : 's'} updated`); }
  catch (e) { toast(errText(e), 'err'); }
}
async function saveBudgets() {
  try {
    const rows = [];
    document.querySelectorAll('[data-bud]').forEach((i) => { const c = parseCents(i.value || '0'); if (c !== null && c >= 0) rows.push({ user_id: S.uid, category_id: i.dataset.bud, amount_cents: c, updated_at: new Date().toISOString() }); });
    if (rows.length) await must(sb.from('budgets').upsert(rows, { onConflict: 'category_id' }));
    rows.forEach((r) => (S.budgets[r.category_id] = r.amount_cents));
    const name = $('#ncname').value.trim();
    if (name) {
      if (S.cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast('That category already exists.', 'warn');
      const cat = await must(sb.from('categories').insert({ user_id: S.uid, name: name.slice(0, 40), icon: $('#ncicon').value.trim() || '•', color: SWATCHES[(S.cats.length + 3) % SWATCHES.length], sort: S.cats.length + 1 }).select('id,name,icon,color,sort,is_fallback').single());
      const amount = Math.max(0, parseCents($('#ncbud').value || '0') || 0);
      await must(sb.from('budgets').insert({ user_id: S.uid, category_id: cat.id, amount_cents: amount }));
      S.cats.push(cat); S.budgets[cat.id] = amount;
    }
    closeSheet(); snapshot(); render(true); toast('Budgets saved');
  } catch (e) { toast(errText(e), 'err'); }
}
async function testWallet() {
  S.walletMsg = { ok: true, text: 'Sending…' }; render(true);
  const card = activeCards()[0]?.name || 'My Visa';
  try {
    const res = await fetch(WALLET_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': S.user.api_token }, body: JSON.stringify({ amount: '$4.25', merchant: 'Test Coffee Shop', card, test: true }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = data.error || data.message || data.msg || '';
      if (res.status === 401 && !/api key/i.test(why)) throw new Error(`401 ${why || 'Unauthorized'}: in Supabase, turn off “Verify JWT” for the wallet function and click Save changes.`);
      if (res.status === 401) throw new Error(why || `Invalid API key: ${S.user.api_token ? 'copy the key again.' : 'your account has no key yet.'}`);
      throw new Error(`${res.status} ${why || 'Error'}. Check Edge Functions → wallet → Logs.`);
    }
    const p = data.parsed || {};
    S.walletMsg = { ok: true, text: `✓ Connection works. ${money(p.amount_cents || 0)} at ${p.merchant} → ${p.card_matched ? `matched “${p.card}”` : `“${p.card}” not matched yet`}.` };
  } catch (e) {
    S.walletMsg = { ok: false, text: '✕ ' + (isNetErr(e) ? 'Couldn’t reach the endpoint. Check the wallet function is deployed.' : e.message) };
  }
  render(true);
}
async function exportCsv() {
  try {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const page = await must(sb.from('transactions').select('*').order('occurred_at', { ascending: false }).range(from, from + 999));
      rows.push(...page.map(fromTx)); if (page.length < 1000) break;
    }
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [['date', 'amount', 'currency', 'merchant', 'card', 'wallet_card_name', 'category', 'note', 'source'], ...rows.map((t) => [t.at, decimal(t.cents), S.user.currency, t.merchant, cardById(t.card)?.name || '', t.raw || '', catById(t.cat)?.name || '', t.note, t.src])].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `pocket-ledger-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Exported ${rows.length} transactions`);
  } catch (e) { toast(errText(e), 'err'); }
}

/* ───────────── CSV import ───────────── */
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false; const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((c) => c.trim())) rows.push(row); row = []; }
    else f += ch;
  }
  row.push(f); if (row.some((c) => c.trim())) rows.push(row); return rows;
}
function parseDate(v, order) {
  const s = String(v || '').trim(); let m;
  const mk = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? new Date(y, mo - 1, d, 12) : null);
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return order === 'dmy' ? mk(y, +m[2], +m[1]) : mk(y, +m[1], +m[2]); }
  const d = new Date(s); return isNaN(d) ? null : mk(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
async function readCsv(file) {
  if (!file) return;
  const rows = parseCsv(await file.text());
  if (!rows.length) return toast('That file has no rows.', 'warn');
  const first = rows[0], header = first.every((c) => !/^\s*-?\$?\d[\d,.]*\s*$/.test(c)) && !first.some((c) => /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(c));
  const h = header ? first.map((x) => x.toLowerCase()) : [];
  const find = (...res) => { for (const re of res) { const i = h.findIndex((x) => re.test(x)); if (i >= 0) return i; } return -1; };
  const map = header ? { date: find(/date|posted/), merch: find(/description|merchant|payee|name|details|memo/), amount: find(/amount|value/), debit: find(/debit|withdraw|money out/), credit: find(/credit|deposit|money in/) } : { date: 0, merch: 1, amount: 2, debit: first.length > 3 ? 2 : -1, credit: first.length > 3 ? 3 : -1 };
  const body = header ? rows.slice(1) : rows;
  const order = body.slice(0, 60).some((r) => +(String(r[map.date] || '').match(/^(\d{1,2})[/.-]/)?.[1] || 0) > 12) ? 'dmy' : 'mdy';
  S.imp = { name: file.name, rows, header, map, mode: map.amount < 0 && map.debit >= 0 ? 'split' : !header && first.length >= 4 ? 'split' : 'single', neg: false, order, card: '' };
  render(true);
}
function csvMapped(s) {
  return (s.header ? s.rows.slice(1) : s.rows).map((r) => {
    const date = s.map.date >= 0 ? parseDate(r[s.map.date], s.order) : null, merchant = s.map.merch >= 0 ? String(r[s.map.merch] || '').trim() : '';
    let cents = null;
    if (s.mode === 'single' && s.map.amount >= 0) { const v = parseCents(r[s.map.amount] || ''); cents = v === null ? null : s.neg ? -v : v; }
    if (s.mode === 'split') { const d = s.map.debit >= 0 ? parseCents(r[s.map.debit] || '') : null, c = s.map.credit >= 0 ? parseCents(r[s.map.credit] || '') : null; cents = d ? Math.abs(d) : c ? -Math.abs(c) : null; }
    return { date, merchant, cents };
  });
}
function renderCsvMap() {
  const s = S.imp, box = $('#csvmap'); if (!s || !box) return;
  const cols = s.header ? s.rows[0] : s.rows[0].map((_, i) => 'Column ' + (i + 1)), sample = (s.header ? s.rows[1] : s.rows[0]) || [];
  const sel = (label, k) => `<label class="field"><span>${label}</span><select class="r" data-map="${k}"><option value="-1">None</option>${cols.map((c, i) => `<option value="${i}" ${s.map[k] === i ? 'selected' : ''}>${esc(c || 'Column ' + (i + 1))}${sample[i] ? ' · ' + esc(String(sample[i]).slice(0, 18)) : ''}</option>`).join('')}</select></label>`;
  const m = csvMapped(s), valid = m.filter((x) => x.date && x.merchant && x.cents);
  box.innerHTML = `<div class="form-h">Columns</div><div class="group"><div class="row"><span class="main title">First row is a header</span>${sw('csvh', s.header, 'First row is a header')}</div>${sel('Date', 'date')}${sel('Merchant', 'merch')}</div>
    <div class="form-h">Amount</div><div class="seg"><button type="button" data-mode="single" aria-pressed="${s.mode === 'single'}">One Column</button><button type="button" data-mode="split" aria-pressed="${s.mode === 'split'}">Debit / Credit</button></div>
    <div class="group" style="margin-top:10px">${s.mode === 'single' ? sel('Amount', 'amount') + `<div class="row"><span class="main title">Expenses are negative</span>${sw('csvneg', s.neg, 'Expenses are negative numbers')}</div>` : sel('Debit', 'debit') + sel('Credit', 'credit')}</div>
    <div class="form-h">Options</div><div class="group"><label class="field"><span>Dates</span><select class="r" id="csvorder"><option value="mdy" ${s.order === 'mdy' ? 'selected' : ''}>MM/DD/YYYY</option><option value="dmy" ${s.order === 'dmy' ? 'selected' : ''}>DD/MM/YYYY</option></select></label><label class="field"><span>Card</span><select class="r" id="csvcard"><option value="">None</option>${S.cards.map((c) => `<option value="${esc(c.id)}" ${s.card === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="form-h">Preview · ${valid.length} of ${m.length} rows readable</div><div class="group">${m.slice(0, 6).map((x) => `<div class="row" style="${x.date && x.merchant && x.cents ? '' : 'opacity:.4'}"><span class="main"><div class="title ell">${esc(x.merchant || '—')}</div><div class="subtitle">${x.date ? esc(x.date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })) : 'Unreadable date'}</div></span><span class="tx-amt ${x.cents < 0 ? 'refund' : ''}">${x.cents ? esc(money(x.cents)) : '—'}</span></div>`).join('')}</div>
    <p class="foot">Positive amounts are spending, negative ones are refunds or payments.</p>
    <button class="btn" style="margin-top:18px" data-act="doimport" ${valid.length ? '' : 'disabled'}>Import ${valid.length} Transactions</button>`;
  box.querySelectorAll('[data-map]').forEach((el) => el.addEventListener('change', () => { s.map[el.dataset.map] = +el.value; renderCsvMap(); }));
  box.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { s.mode = b.dataset.mode; renderCsvMap(); }));
  $('#csvh').addEventListener('change', (e) => { s.header = e.target.checked; renderCsvMap(); });
  $('#csvneg')?.addEventListener('change', (e) => { s.neg = e.target.checked; renderCsvMap(); });
  $('#csvorder').addEventListener('change', (e) => { s.order = e.target.value; renderCsvMap(); });
  $('#csvcard').addEventListener('change', (e) => { s.card = e.target.value; });
}
async function doImport(btn) {
  const s = S.imp, valid = csvMapped(s).filter((x) => x.date && x.merchant && x.cents);
  if (!valid.length) return;
  btn.disabled = true; btn.textContent = 'Importing…';
  try {
    const times = valid.map((x) => x.date.getTime());
    const existing = await must(sb.from('transactions').select('amount_cents,merchant_key,card_id,occurred_at').gte('occurred_at', new Date(Math.min(...times) - 3 * 864e5).toISOString()).lte('occurred_at', new Date(Math.max(...times) + 3 * 864e5).toISOString()).limit(10000));
    const pool = existing.map((e) => ({ ...e, t: new Date(e.occurred_at).getTime(), used: false }));
    const similar = (a, b) => a === b || a.includes(b) || b.includes(a) || (a.split(' ')[0].length >= 3 && a.split(' ')[0] === b.split(' ')[0]);
    const rows = []; let dup = 0;
    for (const x of valid) {
      const key = mKey(x.merchant), card = s.card || null;
      const hit = pool.find((e) => !e.used && Number(e.amount_cents) === x.cents && (!card || !e.card_id || e.card_id === card) && Math.abs(e.t - x.date) <= 3 * 864e5 && similar(e.merchant_key, key));
      if (hit) { hit.used = true; dup++; continue; }
      rows.push(toTx({ id: uuid(), cents: x.cents, merchant: x.merchant.slice(0, 200), key, card, raw: null, cat: categorize(x.merchant), at: x.date.toISOString(), note: '', src: 'import' }));
    }
    for (let i = 0; i < rows.length; i += 500) await must(sb.from('transactions').insert(rows.slice(i, i + 500)));
    S.imp = null; S.page = null; S.anim = 'pop'; await loadMonth(S.month); render(); toast(`Imported ${rows.length} · skipped ${dup} already logged`);
  } catch (e) { btn.disabled = false; btn.textContent = 'Try Again'; toast(errText(e), 'err'); }
}

/* ───────────── Wallet stack interaction ───────────── */
function selectCard(id) {
  const w = $('#wallet'), next = S.selCard === id ? null : id;
  S.selCard = next;
  if (!w) return render();
  w.classList.toggle('is-sel', !!next);
  w.querySelectorAll('.wcard').forEach((c) => c.classList.toggle('sel', c.dataset.v === next));
  sizeWallet();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => render(true), 320);
}

/* ───────────── events ───────────── */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const v = el.dataset.v, act = el.dataset.act;
  const A = {
    tab: () => { if (S.tab === v && !S.page && !S.selCard) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; } S.tab = v; S.page = null; S.selCard = null; S.anim = 'fade'; window.scrollTo(0, 0); if (v === 'activity' && S.activity === null) runActivitySearch(); render(); },
    openpage: () => { S.tab = 'settings'; S.page = v; S.walletMsg = null; S.anim = 'push'; window.scrollTo(0, 0); render(); },
    back: () => { S.page = null; S.anim = 'pop'; window.scrollTo(0, 0); render(); },
    add: () => { const last = LS.get('pl-last-card', null); openSheet({ type: 'add', card: activeCards().some((c) => c.id === last) ? last : activeCards()[0]?.id || null, cat: null }); },
    submitadd: submitAdd,
    adddetails: () => { const d = $('#adddetails'); d.hidden = !d.hidden; if (!d.hidden) $('#note')?.focus(); },
    close: closeSheet,
    month: async () => { S.month = shiftYm(S.month, +v); S.pickedDay = null; render(true); if (!S.txByMonth[S.month]) { try { await loadMonth(S.month); } catch (err) { toast(errText(err), 'err'); } render(true); } else refresh(); },
    selcard: () => selectCard(v),
    day: () => { S.pickedDay = S.pickedDay === +v ? null : +v; render(true); },
    catfilter: () => { Object.assign(S.search, { q: '', card: '', cat: v, from: '', to: '' }); S.tab = 'activity'; S.anim = 'fade'; window.scrollTo(0, 0); runActivitySearch(); render(); },
    edit: () => { const t = findTx(v); if (t) openSheet({ type: 'edit', tx: t, cat: t.cat, card: t.card }); },
    saveedit: saveEdit,
    deltx: () => { const t = S.sheet.tx; confirmSheet('Delete this transaction?', `${t.merchant} · ${money(t.cents)}`, [{ label: 'Delete Transaction', destructive: true, act: () => { closeSheet(); deleteTx(t); toast('Deleted'); } }]); },
    newcard: () => openSheet({ type: 'card', d: { name: '', last4: '', color: SWATCHES[S.cards.length % SWATCHES.length], type: 'credit', limit: null, archived: false } }),
    newcardalias: () => { const alias = S.sheet.alias; openSheet({ type: 'card', alias, d: { name: alias, last4: '', color: SWATCHES[S.cards.length % SWATCHES.length], type: 'credit', limit: null, archived: false } }); },
    opencard: () => { const c = cardById(v); if (c) openSheet({ type: 'card', d: { ...c } }); },
    savecard: saveCard,
    delcard: () => { const id = S.sheet.d.id; confirmSheet('Delete this card?', 'Its transactions are kept and become unassigned.', [{ label: 'Delete Card', destructive: true, act: async () => { try { await must(sb.from('cards').delete().eq('id', id)); S.cards = S.cards.filter((c) => c.id !== id); for (const [k, cid] of Object.entries(S.aliases)) if (cid === id) delete S.aliases[k]; if (S.selCard === id) S.selCard = null; closeSheet(); await loadMonth(S.month); render(true); toast('Card deleted'); } catch (err) { toast(errText(err), 'err'); } } }]); },
    linkcard: () => openSheet({ type: 'linkcard', alias: v }),
    dolink: () => doLink(v),
    editbudgets: () => openSheet({ type: 'budgets' }),
    savebudgets: saveBudgets,
    filters: () => openSheet({ type: 'filters' }),
    resetf: () => { Object.assign(S.search, { card: '', cat: '', from: '', to: '' }); openSheet({ type: 'filters' }); runActivitySearch(); render(true); },
    clearf: () => { if (v === 'date') { S.search.from = ''; S.search.to = ''; } else S.search[v] = ''; runActivitySearch(); render(true); },
    addrule: async () => {
      const k = normM($('#rk').value).slice(0, 100), c = $('#rc').value;
      if (k.length < 2 || !c) return toast('Enter a keyword (2+ letters) and pick a category.', 'warn');
      try { const row = await must(sb.from('merchant_rules').upsert({ user_id: S.uid, keyword: k, category_id: c, source: 'user' }, { onConflict: 'user_id,keyword' }).select().single()); S.rules = [{ id: row.id, k, c, s: 'user' }, ...S.rules.filter((r) => r.k !== k)]; render(true); toast('Rule added'); } catch (err) { toast(errText(err), 'err'); }
    },
    delrule: async () => { try { await must(sb.from('merchant_rules').delete().eq('id', v)); S.rules = S.rules.filter((r) => r.id !== v); render(true); } catch (err) { toast(errText(err), 'err'); } },
    copyurl: () => copy(WALLET_URL),
    copytok: () => copy(S.user.api_token),
    showtok: () => { S.showTok = !S.showTok; render(true); },
    testwallet: testWallet,
    regen: () => confirmSheet('Regenerate your key?', 'Your Shortcut stops working until you paste the new key into it.', [{ label: 'Regenerate Key', destructive: true, act: async () => { try { const tok = await must(sb.rpc('regenerate_api_token')); S.user.api_token = tok; S.showTok = true; render(true); toast('New key ready. Update your Shortcut.'); } catch (err) { toast(errText(err), 'err'); } } }]),
    doimport: () => doImport(el),
    export: exportCsv,
    dismissinstall: () => { LS.set('pl-install-dismissed', Date.now()); render(true); },
    loginstep: () => { LS.set('pl-seen-welcome', true); Object.assign(S.login, { step: v, error: '' }); render(); },
    signout: () => confirmSheet('Sign out?', S.email, [{ label: 'Sign Out', destructive: true, act: async () => { await sb.auth.signOut(); LS.del('pl-snapshot'); LS.del('pl-queue'); location.reload(); } }]),
    alertcancel: () => { S.alert = null; renderAlert(); },
    alertdo: () => { const a = S.alert?.actions[+v]; S.alert = null; renderAlert(); a?.act(); },
  };
  A[act]?.();
});
document.addEventListener('input', (e) => { if (e.target.id === 'q') { S.search.q = e.target.value; runActivitySearch(); } });
document.addEventListener('change', async (e) => {
  if (e.target.id === 'currency') {
    const cur = e.target.value;
    try { await must(sb.from('users').update({ currency: cur }).eq('id', S.uid)); S.user.currency = cur; snapshot(); render(true); } catch (err) { toast(errText(err), 'err'); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (S.alert) { S.alert = null; renderAlert(); } else if (S.sheet) closeSheet(); return; }
  // a physical keyboard drives the amount keypad too
  if (S.sheet?.type === 'add' && !e.target.closest?.('input,textarea,select')) {
    if (/^[0-9]$/.test(e.key)) keyIn(S.sheet, e.key);
    else if (e.key === '.' || e.key === ',') keyIn(S.sheet, '.');
    else if (e.key === 'Backspace') keyIn(S.sheet, 'del');
    else if (e.key === 'Enter') submitAdd();
  }
});
window.addEventListener('online', () => { S.online = true; flushQueue(); refresh(); render(true); });
window.addEventListener('offline', () => { S.online = false; render(true); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { flushQueue(); refresh(); } });
setInterval(() => { if (document.visibilityState === 'visible' && S.session) refresh(); }, 30000);

/* ───────────── boot ───────────── */
async function start(session) {
  if (S.login.step === 'newpass') return;
  S.session = session; S.uid = session?.user?.id || null; S.email = session?.user?.email || '';
  if (!S.uid) { S.ready = true; render(); return; }
  if (restoreSnapshot()) S.ready = true;
  render();
  try { await loadAll(); S.ready = true; S.note = ''; flushQueue(); }
  catch (e) { S.ready = true; S.note = isNetErr(e) ? '' : 'Couldn’t load your data: ' + (e.message || e) + '. Has the database setup been run?'; }
  render(true);
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (!CONFIGURED) render();
else {
  sb.auth.getSession().then(({ data }) => start(data.session));
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { S.session = null; S.login.step = 'newpass'; render(); return; }
    if (event === 'SIGNED_IN' && session?.user?.id !== S.uid) start(session);
    if (event === 'SIGNED_OUT') { S.session = null; S.uid = null; render(); }
    if (event === 'TOKEN_REFRESHED') S.session = session;
  });
  render();
}
})();
