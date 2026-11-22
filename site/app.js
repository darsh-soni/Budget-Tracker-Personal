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
const SWATCHES = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#008300', '#6250d6', '#e34948', '#26262b', '#8a8984'];
const NO_CARD = '#8a8984';
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
  tab: 'cards', activeCard: 0, picked: null, pickedDay: null,
  search: { q: '', card: '', cat: '', from: '', to: '' }, activity: null, activityLoading: false,
  sheet: null, login: { step: 'signin', email: '', busy: false, error: '', info: '' },
};

/* ───────────── helpers ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID();
function ymOf(d) { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function shiftYm(ym, n) { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + n, 1)); }
function monthRange(ym) { const [y, m] = ym.split('-').map(Number); return { start: new Date(y, m - 1, 1).toISOString(), end: new Date(y, m, 1).toISOString() }; }
function monthName(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', ...(y === new Date().getFullYear() ? {} : { year: 'numeric' }) }); }
function money(c, o = {}) {
  const v = c / 100, noC = o.compact && (Number.isInteger(v) || Math.abs(v) >= 1000);
  try { return new Intl.NumberFormat('en-CA', { style: 'currency', currency: S.user.currency || 'CAD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: noC ? 0 : 2, maximumFractionDigits: noC ? 0 : 2, signDisplay: o.sign ? 'exceptZero' : 'auto' }).format(v); }
  catch { return '$' + v.toFixed(2); }
}
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
  return d.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric', ...(d.getFullYear() === t.getFullYear() ? {} : { year: 'numeric' }) });
}
const timeLabel = (iso) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
function localInput(d) { d = new Date(d); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
let toastT;
function toast(msg) { const r = $('#toast-root'); r.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toastT); toastT = setTimeout(() => (r.innerHTML = ''), 3600); }
const sw = (id, on, label) => `<label class="sw"><input type="checkbox" role="switch" id="${id}" aria-label="${esc(label)}" ${on ? 'checked' : ''}><span></span></label>`;
const isNetErr = (e) => !navigator.onLine || e instanceof TypeError || /fetch|network|load failed/i.test(e?.message || '');
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

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
    S.user = user; S.note = ''; render();
  } catch (e) { if (!quiet) toast(errText(e)); }
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
  putLocal(tx); render();
  try { await must(sb.from('transactions').insert(toTx(tx))); snapshot(); }
  catch (e) {
    if (isNetErr(e)) { enqueue(tx); toast('Offline. Saved on this phone and will sync when you’re back online.'); }
    else { S.txByMonth[ymOf(tx.at)] = (S.txByMonth[ymOf(tx.at)] || []).filter((t) => t.id !== tx.id); render(); toast(errText(e)); }
  }
}
async function updateTx(tx, prevYm) {
  putLocal(tx, prevYm); render();
  const row = toTx(tx); delete row.id; delete row.user_id; delete row.client_id;
  try { await must(sb.from('transactions').update(row).eq('id', tx.id)); snapshot(); } catch (e) { toast(errText(e)); refresh(); }
}
async function deleteTx(tx) {
  const ym = ymOf(tx.at);
  if (S.txByMonth[ym]) S.txByMonth[ym] = S.txByMonth[ym].filter((t) => t.id !== tx.id);
  if (S.activity) S.activity = S.activity.filter((t) => t.id !== tx.id);
  LS.set('pl-queue', queue().filter((q) => q.id !== tx.id));
  render();
  try { await must(sb.from('transactions').delete().eq('id', tx.id)); snapshot(); } catch (e) { toast(errText(e)); refresh(); }
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
  if (msgs.length) { LS.set('pl-alerts', seen); setTimeout(() => toast('⚠︎ ' + msgs.join(' · ')), 900); }
}

/* ───────────── icons ───────────── */
const P = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const I = {
  cards: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" ${P}/><path d="M2.5 9.5h19M6 15h4" ${P}/></svg>`,
  activity: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13" ${P}/><circle cx="3.5" cy="6" r="1.2" fill="currentColor"/><circle cx="3.5" cy="12" r="1.2" fill="currentColor"/><circle cx="3.5" cy="18" r="1.2" fill="currentColor"/></svg>`,
  budget: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9z" ${P}/><path d="M15 2.5A7 7 0 0 1 21.5 9H15z" ${P}/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" ${P}/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" ${P}/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  left: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  right: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  share: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4" ${P}/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" ${P}/></svg>`,
};

/* ───────────── views ───────────── */
function viewSetup() {
  return `<div class="center"><h1 class="title">Almost there</h1><p class="muted">This copy of Pocket Ledger isn’t connected to a database yet. Add your Supabase project URL and anon key to <code>config.js</code>, then reload. The README has step-by-step instructions.</p></div>`;
}
function viewLogin() {
  const L = S.login, busy = L.busy ? 'disabled' : '';
  const email = `<input class="t" id="lemail" type="email" inputmode="email" autocomplete="username" autocapitalize="none" placeholder="you@example.com" aria-label="Email" required value="${esc(L.email)}">`;
  const pw = (id, ac, ph) => `<input class="t" id="${id}" type="password" autocomplete="${ac}" placeholder="${ph}" aria-label="${ph}" required minlength="8" style="border-top:.5px solid var(--sep)">`;
  let body = '';
  if (L.step === 'signin') body = `<form id="signinf"><div class="group">${email}${pw('lpass', 'current-password', 'Password')}</div><button class="btn" style="margin-top:12px" ${busy}>${L.busy ? 'Signing in…' : 'Sign In'}</button></form>
    <button class="link" style="width:100%;margin-top:8px" data-act="loginstep" data-v="signup">New here? Create an account</button>
    <button class="link" style="width:100%" data-act="loginstep" data-v="reset">Forgot password?</button>`;
  else if (L.step === 'signup') body = `<form id="signupf"><div class="group">${email}${pw('lpass', 'new-password', 'Password (8+ characters)')}</div><button class="btn" style="margin-top:12px" ${busy}>${L.busy ? 'Creating…' : 'Create Account'}</button></form>
    <button class="link" style="width:100%;margin-top:8px" data-act="loginstep" data-v="signin">Already have an account? Sign in</button>`;
  else if (L.step === 'reset') body = `<form id="resetf"><p class="muted" style="text-align:center">We’ll email you a link to set a new password. Open it on this device.</p><div class="group">${email}</div><button class="btn" style="margin-top:12px" ${busy}>${L.busy ? 'Sending…' : 'Email Reset Link'}</button></form>
    <button class="link" style="width:100%;margin-top:8px" data-act="loginstep" data-v="signin">Back to sign in</button>`;
  else if (L.step === 'newpass') body = `<form id="newpassf"><p class="muted" style="text-align:center">Choose a new password.</p><div class="group">${pw('lnewpass', 'new-password', 'New password (8+ characters)').replace('border-top:.5px solid var(--sep)', '')}</div><button class="btn" style="margin-top:12px" ${busy}>${L.busy ? 'Saving…' : 'Save Password'}</button></form>`;
  else if (L.step === 'checkemail') body = `<div class="banner info"><span aria-hidden="true" style="font-size:22px">✉️</span><span class="small">${esc(L.info)}</span></div><button class="btn alt" style="margin-top:12px" data-act="loginstep" data-v="signin">I’ve confirmed. Sign in</button>`;
  return `<div class="center"><div style="text-align:center;margin-bottom:24px"><img class="logo" src="icons/apple-touch-icon.png" alt=""><h1 class="title" style="margin:16px 0 4px">Pocket Ledger</h1><p class="muted" style="margin:0">Every Apple Pay tap, sorted by card and budget.</p></div>
  ${body}${L.error ? `<p class="err" role="alert">${esc(L.error)}</p>` : ''}</div>`;
}
function renderTabs() {
  const t = (id, label) => `<button class="tab" data-act="tab" data-v="${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${I[id]}${label}</button>`;
  $('#tabs').innerHTML = t('cards', 'Cards') + t('activity', 'Activity') + `<button class="tab" data-act="add" aria-label="Add expense"><span class="plus">${I.plus}</span></button>` + t('budget', 'Budget') + t('settings', 'Settings');
}
function monthNav() {
  const cur = S.month >= ymOf(new Date());
  return `<div class="monthnav"><button class="iconbtn" data-act="month" data-v="-1" aria-label="Previous month">${I.left}</button><strong>${esc(monthName(S.month))}</strong><button class="iconbtn" data-act="month" data-v="1" aria-label="Next month" ${cur ? 'disabled' : ''}>${I.right}</button></div>`;
}
function statusLine() {
  const q = queue().length;
  if (!S.online) return `<div class="banner warn"><span aria-hidden="true">ⓘ</span><span class="small">Offline. Showing your last loaded data${q ? ` · ${q} entr${q === 1 ? 'y' : 'ies'} waiting to sync` : ''}.</span></div>`;
  if (S.note) return `<div class="status">${esc(S.note)}</div>`;
  if (!S.ready) return `<div class="status">Loading your ledger…</div>`;
  return '';
}
function txList(list, { showCard = true, empty = 'No transactions yet.' } = {}) {
  if (!list.length) return `<div class="empty">${esc(empty)}</div>`;
  const groups = [];
  for (const t of [...list].sort((a, b) => b.at.localeCompare(a.at))) {
    const d = new Date(t.at).toDateString(); let g = groups[groups.length - 1];
    if (!g || g.d !== d) groups.push((g = { d, items: [], total: 0 }));
    g.items.push(t); g.total += t.cents;
  }
  return groups.map((g) => `<section><div class="day"><span>${esc(dayLabel(g.items[0].at))}</span><span class="num">${money(g.total)}</span></div><div class="group">${g.items.map((t) => {
    const c = catById(t.cat), card = cardById(t.card), q = queue().some((x) => x.id === t.id);
    const cardTxt = card ? card.name : t.raw ? `${t.raw} (unlinked)` : 'No card';
    return `<button class="cell ind" data-act="edit" data-v="${esc(t.id)}"><span class="badge" style="background:${esc(c?.color || NO_CARD)}" aria-hidden="true">${esc(c?.icon || '❔')}</span><span class="grow"><div class="ell" style="font-weight:500">${esc(t.merchant)}</div><div class="faint ell small">${esc(c?.name || 'Uncategorized')}${showCard ? ' · ' + esc(cardTxt) : ''} · ${esc(timeLabel(t.at))}${t.src === 'wallet' ? ' · Wallet' : ''}${q ? ' · waiting to sync' : ''}</div></span><span class="amt-col ${t.cents < 0 ? 'refund' : ''}">${money(t.cents, { sign: t.cents < 0 })}</span></button>`;
  }).join('')}</div></section>`).join('');
}
function findTx(id) { for (const l of [...Object.values(S.txByMonth), S.activity || []]) { const t = l.find((x) => x.id === id); if (t) return t; } return null; }
function unknownBanners() {
  const counts = {};
  for (const t of S.txByMonth[S.month] || []) if (!t.card && t.raw) { const k = t.raw.toLowerCase(); (counts[k] ||= { raw: t.raw, n: 0 }).n++; }
  return Object.values(counts).slice(0, 3).map((u) => `<button class="banner info" data-act="linkcard" data-v="${esc(u.raw)}"><span aria-hidden="true" style="font-size:22px">💳</span><span class="grow"><strong>New card from Wallet: “${esc(u.raw)}”</strong><div class="muted small">${u.n} transaction${u.n === 1 ? '' : 's'} · tap to link it to one of your cards</div></span></button>`).join('');
}
function installBanner() {
  if (!isIOS() || standalone() || LS.get('pl-install-dismissed', 0) > Date.now() - 14 * 864e5) return '';
  return `<div class="banner info"><img src="icons/apple-touch-icon.png" alt="" width="40" height="40" style="border-radius:10px"><span class="grow small"><strong>Install on your iPhone</strong><br>Tap ${I.share} <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</span><button class="link" data-act="dismissinstall" aria-label="Dismiss">✕</button></div>`;
}

function viewCards() {
  const txs = S.txByMonth[S.month] || [], cards = activeCards();
  const by = new Map(); for (const t of txs) by.set(t.card || null, (by.get(t.card || null) || 0) + t.cents);
  const total = txs.reduce((s, t) => s + t.cents, 0);
  if (S.activeCard > cards.length) S.activeCard = 0;
  const ac = S.activeCard > 0 ? cards[S.activeCard - 1] : null;
  const slides = [`<div class="pc all" role="group" aria-label="All cards"><div class="top"><span>All cards</span><span class="kind">${cards.length} card${cards.length === 1 ? '' : 's'}</span></div><div><div class="sub">Spent in ${esc(monthName(S.month))}</div><div class="amt">${money(total)}</div><div class="sub">${txs.length} transaction${txs.length === 1 ? '' : 's'}</div></div></div>`]
    .concat(cards.map((c) => {
      const sp = by.get(c.id) || 0, pct = c.limit ? Math.min(100, sp / c.limit * 100) : 0;
      return `<div class="pc" style="background:${esc(c.color)}" role="group" aria-label="${esc(c.name)}"><div class="top"><span class="ell">${esc(c.name)}</span><span class="kind">${esc(c.type)}${c.last4 ? ' ·· ' + esc(c.last4) : ''}</span></div><div><div class="sub">Month to date</div><div class="amt">${money(sp)}</div>${c.limit ? `<div class="meter" role="progressbar" aria-label="Limit used" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><div class="sub" style="margin-top:6px">${sp > c.limit ? money(sp - c.limit) + ' over' : money(c.limit - sp) + ' left'} of ${money(c.limit, { compact: true })} limit</div>` : '<div class="sub">No monthly limit</div>'}</div></div>`;
    }));
  if (!cards.length) slides.push(`<button class="pc add" data-act="newcard"><span style="font-size:34px">＋</span><strong>Add your first card</strong><span class="small muted">Name it like Apple Wallet does</span></button>`);
  let breakdown = '';
  if (!ac && total !== 0) {
    const rows = [...cards.map((c) => ({ id: c.id, name: c.name, color: c.color, v: by.get(c.id) || 0 })), { id: 'none', name: 'No card / cash', color: NO_CARD, v: by.get(null) || 0 }].filter((r) => r.v > 0);
    const pos = rows.reduce((s, r) => s + r.v, 0) || 1, pk = rows.find((r) => r.id === S.picked);
    breakdown = `<div class="sec">Spending by card</div><div class="group" style="padding:16px"><div class="small" style="min-height:20px;margin-bottom:8px">${pk ? `<strong>${esc(pk.name)}</strong> · <span class="num">${money(pk.v)}</span> <span class="faint">(${Math.round(pk.v / pos * 100)}%)</span>` : `<span class="faint">Tap a segment for details · total ${money(total)}</span>`}</div><div class="stack" role="img" aria-label="Share of spending by card">${rows.map((r) => `<button data-act="pick" data-v="${esc(r.id)}" aria-pressed="${S.picked === r.id}" aria-label="${esc(r.name)} ${money(r.v)}" style="flex:${r.v} 1 0;background:${esc(r.color)}"></button>`).join('')}</div><div style="margin-top:10px">${rows.map((r) => `<div class="row" style="min-height:36px"><span class="dot" style="background:${esc(r.color)}"></span><span class="grow ell">${esc(r.name)}</span><span class="faint num small">${Math.round(r.v / pos * 100)}%</span><span class="num" style="font-weight:600;min-width:84px;text-align:right">${money(r.v)}</span></div>`).join('')}</div></div>`;
  }
  const nudge = !S.user.last_wallet_at && cards.length ? `<button class="banner" data-act="wallet" style="margin-top:16px"><span aria-hidden="true" style="font-size:22px">⚡️</span><span class="grow"><strong>Log Apple Pay taps automatically</strong><div class="muted small">Set up the Shortcuts automation in 2 minutes.</div></span><span class="chev"></span></button>` : '';
  return `<h1 class="title">Cards</h1>${installBanner()}${statusLine()}${monthNav()}${unknownBanners()}<div class="carousel" id="carousel" aria-label="Cards">${slides.join('')}</div>${cards.length ? `<div class="dots" aria-hidden="true">${[0, ...cards].map((_, i) => `<i class="${i === S.activeCard ? 'on' : ''}"></i>`).join('')}</div>` : ''}${breakdown}${nudge}<div class="sec">${ac ? esc(ac.name) + ' transactions' : 'Transactions'}</div>${txList(ac ? txs.filter((t) => t.card === ac.id) : txs, { showCard: !ac, empty: ac ? 'No spending on this card this month.' : 'Nothing yet this month. Tap ＋ to add an expense.' })}`;
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
    } catch (e) {
      // offline: fall back to whatever months are loaded
      S.activity = Object.values(S.txByMonth).flat().filter((t) => (!f.q || normM(t.merchant).includes(normM(f.q))) && (!f.card || (f.card === 'none' ? !t.card : t.card === f.card)) && (!f.cat || t.cat === f.cat));
    }
    S.activityLoading = false; render();
  }, 250);
}
function viewActivity() {
  const f = S.search, list = S.activity || [], n = [f.card, f.cat, f.from || f.to].filter(Boolean).length, total = list.reduce((s, t) => s + t.cents, 0);
  return `<h1 class="title">Activity</h1>${statusLine()}<div class="row"><div class="pill grow"><input class="t" id="q" type="search" placeholder="Search merchants" aria-label="Search merchants" value="${esc(f.q)}" enterkeyhint="search"></div><button class="btn sm alt" data-act="filters">Filter${n ? ` (${n})` : ''}</button></div>
  ${n ? `<div class="chips" style="margin-top:8px">${f.card ? `<button class="chip" aria-pressed="true" data-act="clearf" data-v="card">${esc(f.card === 'none' ? 'No card' : cardById(f.card)?.name || 'Card')} ✕</button>` : ''}${f.cat ? `<button class="chip" aria-pressed="true" data-act="clearf" data-v="cat">${esc(catById(f.cat)?.name || 'Category')} ✕</button>` : ''}${f.from || f.to ? `<button class="chip" aria-pressed="true" data-act="clearf" data-v="date">${esc(f.from || '…')} → ${esc(f.to || '…')} ✕</button>` : ''}</div>` : ''}
  <p class="foot">${S.activity === null || S.activityLoading ? 'Searching…' : `${list.length}${list.length === 300 ? '+' : ''} transaction${list.length === 1 ? '' : 's'} · ${money(total)}`}</p>
  ${S.activity === null ? '' : txList(list, { empty: f.q || n ? 'No matching transactions.' : 'No transactions yet.' })}`;
}

function viewBudget() {
  const txs = S.txByMonth[S.month] || [], b = S.budgets;
  const spent = {}; for (const t of txs) spent[t.cat || '_'] = (spent[t.cat || '_'] || 0) + t.cents;
  const totalB = S.cats.reduce((s, c) => s + (b[c.id] || 0), 0), totalS = txs.reduce((s, t) => s + t.cents, 0), left = totalB - totalS;
  const [y, m] = S.month.split('-').map(Number), dim = new Date(y, m, 0).getDate(), cur = S.month === ymOf(new Date()), today = new Date().getDate();
  const daily = Array(dim).fill(0); for (const t of txs) { const d = new Date(t.at); if (d.getMonth() + 1 === m) daily[d.getDate() - 1] += Math.max(0, t.cents); }
  const max = Math.max(1, ...daily), daysLeft = cur ? dim - today + 1 : 0, pd = S.pickedDay;
  return `<div class="head"><h1 class="title">Budget</h1><button class="link" data-act="editbudgets">Edit</button></div>${statusLine()}${monthNav()}
  <div class="kpis"><div class="kpi"><div class="k">Spent</div><div class="v">${money(totalS, { compact: true })}</div></div><div class="kpi"><div class="k">Budget</div><div class="v">${money(totalB, { compact: true })}</div></div><div class="kpi"><div class="k">${left < 0 ? 'Over' : 'Left'}</div><div class="v" style="${left < 0 ? 'color:var(--bad)' : ''}">${left < 0 ? '⚠︎ ' : ''}${money(Math.abs(left), { compact: true })}</div></div></div>
  ${cur && left > 0 && daysLeft ? `<p class="foot">About ${money(Math.floor(left / daysLeft))} a day for the next ${daysLeft} day${daysLeft === 1 ? '' : 's'}.</p>` : ''}
  <div class="sec">Daily spending</div><div class="group" style="padding:8px 12px 10px"><div class="bars" role="img" aria-label="Spending per day">${pd !== null && pd < dim ? `<span class="tip" style="left:${(pd + .5) / dim * 100}%">${esc(new Date(y, m - 1, pd + 1).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }))} · ${money(daily[pd])}</span>` : ''}${daily.map((v, i) => `<button class="${cur && i + 1 > today ? 'future' : ''}" data-act="day" data-v="${i}" aria-pressed="${pd === i}" aria-label="Day ${i + 1}: ${money(v)}"><i style="height:${v / max * 100}%"></i></button>`).join('')}</div><div class="axis"><span>1</span><span>${Math.ceil(dim / 2)}</span><span>${dim}</span></div></div>
  <div class="sec">Categories</div><div class="group">${S.cats.map((c) => {
    const sp = spent[c.id] || 0, bud = b[c.id] || 0, pct = bud ? sp / bud * 100 : 0, over = bud > 0 && sp > bud, near = !over && pct >= 80;
    return `<div class="cell" style="display:block;padding:12px 16px"><div class="row" style="gap:10px"><span class="badge" style="background:${esc(c.color)}" aria-hidden="true">${esc(c.icon)}</span><span class="grow" style="font-weight:500">${esc(c.name)}</span><span class="num" style="font-weight:600">${money(sp)}</span></div>${bud ? `<div class="meter" style="margin-top:10px" role="progressbar" aria-label="${esc(c.name)} budget used" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, pct)}%;background:${esc(c.color)}"></i></div><div class="row small" style="justify-content:space-between;margin-top:6px"><span style="color:${over ? 'var(--bad)' : near ? 'var(--warn)' : 'var(--text-3)'};font-weight:${over || near ? 600 : 400}">${over ? '⚠︎ ' + money(sp - bud) + ' over' : near ? '● ' + Math.round(pct) + '% used' : money(bud - sp) + ' left'}</span><span class="faint num">of ${money(bud, { compact: true })}</span></div>` : '<div class="faint small" style="margin-top:6px">No budget set</div>'}</div>`;
  }).join('')}${spent._ ? `<div class="cell"><span class="badge" style="background:${NO_CARD}">❔</span><span class="grow">Uncategorized</span><span class="num" style="font-weight:600">${money(spent._)}</span></div>` : ''}</div>`;
}

function viewSettings() {
  return `<h1 class="title">Settings</h1>${statusLine()}
  <div class="sec">Capture</div><div class="group">
    <button class="cell chev" data-act="wallet"><span class="badge" style="background:#26262b">⚡️</span><span class="grow">Connect Apple Wallet</span><span class="faint small">${S.user.last_wallet_at ? 'Last ' + esc(ago(S.user.last_wallet_at)) : 'Not set up'}</span></button>
    <button class="cell chev" data-act="import"><span class="badge" style="background:#1baf7a;color:#fff">⇪</span><span class="grow">Import bank CSV</span></button>
  </div>
  <div class="sec">Organize</div><div class="group">
    <button class="cell chev" data-act="cardslist"><span class="badge" style="background:#2a78d6">💳</span><span class="grow">Cards</span><span class="faint">${activeCards().length}</span></button>
    <button class="cell chev" data-act="tab" data-v="budget"><span class="badge" style="background:#eb6834">🎯</span><span class="grow">Categories &amp; budgets</span></button>
    <button class="cell chev" data-act="rules"><span class="badge" style="background:#6250d6">🏷️</span><span class="grow">Auto-categorize rules</span><span class="faint">${S.rules.filter((r) => r.s === 'user').length} learned</span></button>
    <label class="cell" for="currency"><span class="badge" style="background:#008300;color:#fff">$</span><span class="grow">Currency</span><select class="t" id="currency" style="width:auto;padding:0 4px;color:var(--text-2)">${['CAD', 'USD', 'EUR', 'GBP', 'AUD'].map((c) => `<option ${S.user.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
  </div>
  <div class="sec">Your data</div><div class="group">
    <button class="cell chev" data-act="export"><span class="grow">Export transactions</span><span class="faint">CSV</span></button>
  </div>
  <p class="foot">Signed in as ${esc(S.email)}. Budget alerts appear as banners when a purchase pushes a budget past 80% or 100%.</p>
  <div class="group" style="margin-top:24px"><button class="cell" data-act="signout"><span class="grow" style="color:var(--bad);text-align:center">Sign Out</span></button></div>`;
}

function render() {
  const app = $('#app'), bar = $('#tabbar');
  if (!CONFIGURED) { bar.hidden = true; app.innerHTML = viewSetup(); return; }
  if (!S.session) { bar.hidden = true; app.innerHTML = viewLogin(); wireLogin(); renderSheet(); return; }
  bar.hidden = false; renderTabs();
  const v = { cards: viewCards, activity: viewActivity, budget: viewBudget, settings: viewSettings }[S.tab]();
  const qF = document.activeElement?.id === 'q', pos = qF ? document.activeElement.selectionStart : 0, cs = $('#carousel')?.scrollLeft;
  app.innerHTML = v;
  if (qF) { const q = $('#q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch {} }
  const car = $('#carousel'); if (car) { if (cs != null) car.scrollLeft = cs; car.onscroll = onCarousel; }
  renderSheet();
}
function onCarousel(e) {
  const el = e.currentTarget, w = (el.children[0]?.offsetWidth || 1) + 12, i = Math.max(0, Math.min(activeCards().length, Math.round(el.scrollLeft / w)));
  if (i !== S.activeCard) { S.activeCard = i; S.picked = null; clearTimeout(onCarousel.t); onCarousel.t = setTimeout(render, 120); }
}

/* ───────────── login ───────────── */
function wireLogin() {
  const go = (id, fn) => $(id)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = $('#lemail'); if (em) S.login.email = em.value.trim();
    Object.assign(S.login, { busy: true, error: '' }); render();
    try { await fn(); } catch (err) { S.login.error = err?.message || 'Something went wrong.'; }
    S.login.busy = false; render();
  });
  const fail = (error) => { if (error) throw error; };
  go('#signinf', async () => {
    const { error } = await sb.auth.signInWithPassword({ email: S.login.email, password: $('#lpass').value });
    if (error && /confirm/i.test(error.message)) throw new Error('Confirm your email first: open the link we sent you, then sign in here.');
    fail(error);
  });
  go('#signupf', async () => {
    const { data, error } = await sb.auth.signUp({ email: S.login.email, password: $('#lpass').value, options: { emailRedirectTo: location.origin + location.pathname } });
    fail(error);
    if (!data.session) Object.assign(S.login, { step: 'checkemail', info: `We sent a confirmation link to ${S.login.email}. Open it (it may open in Safari, that’s fine), then come back here and sign in with your password.` });
  });
  go('#resetf', async () => {
    const { error } = await sb.auth.resetPasswordForEmail(S.login.email, { redirectTo: location.origin + location.pathname });
    fail(error);
    Object.assign(S.login, { step: 'checkemail', info: `If ${S.login.email} has an account, a reset link is on its way. Open it on this device to choose a new password.` });
  });
  go('#newpassf', async () => {
    const { error } = await sb.auth.updateUser({ password: $('#lnewpass').value });
    fail(error);
    S.login.step = 'signin'; toast('Password updated');
    const { data } = await sb.auth.getSession(); if (data.session) await start(data.session);
  });
}

/* ───────────── sheets ───────────── */
function openSheet(s) { s.key = uuid(); S.sheet = s; renderSheet(); }
function closeSheet() { S.sheet = null; renderSheet(); }
function sheetFrame(title, body, action = '') {
  return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div><div class="sheet-h"><button class="link" data-act="close">Cancel</button><h2>${esc(title)}</h2><div style="min-width:60px;text-align:right">${action}</div></div>${body}</div>`;
}
function renderSheet() {
  const root = $('#sheet-root'), s = S.sheet;
  if (!s) { root.innerHTML = ''; root.dataset.key = ''; document.body.style.overflow = ''; return; }
  if (root.dataset.key === s.key) return;
  document.body.style.overflow = 'hidden'; root.dataset.key = s.key;
  root.innerHTML = SHEETS[s.type](s);
  SHEET_INIT[s.type]?.(s);
}
const cardChips = (sel, none = 'Cash / other') => `<div class="chips w">${activeCards().map((c) => `<button type="button" class="chip" data-pick="card" data-v="${esc(c.id)}" aria-pressed="${sel === c.id}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}${c.last4 ? ' ·' + esc(c.last4) : ''}</button>`).join('')}<button type="button" class="chip" data-pick="card" data-v="" aria-pressed="${!sel}">${none}</button></div>`;
const catChips = (sel, auto) => `<div class="chips w">${auto ? `<button type="button" class="chip" data-pick="cat" data-v="" aria-pressed="${!sel}">✨ Auto</button>` : ''}${S.cats.map((c) => `<button type="button" class="chip" data-pick="cat" data-v="${esc(c.id)}" aria-pressed="${sel === c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div>`;
function wirePickers(root, s) {
  root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.pick; s[k] = b.dataset.v || null;
    root.querySelectorAll(`[data-pick="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.v || null) === s[k])));
    s.onPick?.(k);
  }));
}
function copy(text) {
  const done = () => toast('Copied');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
  else fallback();
  function fallback() { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch { toast('Select the text and copy it.'); } ta.remove(); }
}

const SHEETS = {
  add(s) {
    const counts = new Map();
    for (const t of Object.values(S.txByMonth).flat()) { const e = counts.get(t.key) || { m: t.merchant, n: 0, cat: t.cat }; e.n++; counts.set(t.key, e); }
    const recent = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    return sheetFrame('Add Expense', `<form id="addf"><div class="group"><input class="t amount" id="amt" inputmode="decimal" enterkeyhint="next" placeholder="$0.00" aria-label="Amount" autocomplete="off"></div>
      <div class="group" style="margin-top:12px"><input class="t" id="merch" placeholder="Merchant" aria-label="Merchant" autocapitalize="words" autocomplete="off" enterkeyhint="done"></div>
      ${recent.length ? `<div class="chips" style="margin-top:6px">${recent.map((r) => `<button type="button" class="chip" data-recent="${esc(r.m)}" data-cat="${esc(r.cat || '')}">${esc(r.m)}</button>`).join('')}</div>` : ''}
      <div class="sec">Card</div>${activeCards().length ? cardChips(s.card) : '<p class="foot" style="margin-top:0">No cards yet. Add them in Settings → Cards.</p>'}
      <div class="sec">Category</div>${catChips(s.cat, true)}
      <div class="group" style="margin-top:16px"><label class="fl" for="when"><span>Date</span><input class="t" id="when" type="datetime-local" value="${localInput(new Date())}"></label><label class="fl" for="note"><span>Note</span><input class="t" id="note" placeholder="Optional" maxlength="500"></label></div>
      <button class="btn" id="addsave" style="margin-top:20px" disabled>Add Expense</button></form>`, '<button class="link bold" data-act="submitadd">Add</button>');
  },
  edit(s) {
    const t = s.tx;
    return sheetFrame('Transaction', `<div class="group"><input class="t amount" id="eamt" inputmode="decimal" aria-label="Amount" value="${esc(decimal(t.cents))}"></div><p class="foot">Use a negative amount for refunds.${t.src === 'wallet' ? ' Logged from Apple Wallet.' : t.src === 'import' ? ' Imported from CSV.' : ''}</p>
      <div class="group" style="margin-top:12px"><label class="fl" for="emerch"><span>Merchant</span><input class="t" id="emerch" value="${esc(t.merchant)}"></label><label class="fl" for="ewhen"><span>Date</span><input class="t" id="ewhen" type="datetime-local" value="${localInput(t.at)}"></label><label class="fl" for="enote"><span>Note</span><input class="t" id="enote" value="${esc(t.note || '')}" maxlength="500"></label></div>
      <div class="sec">Category</div>${catChips(s.cat)}
      <div class="group" id="simrow" style="margin-top:12px" hidden><div class="cell"><span class="grow">Apply to all “${esc(t.merchant)}”<div class="faint small">Future purchases here will use this category either way.</div></span>${sw('esim', true, 'Apply to similar transactions')}</div></div>
      <div class="sec">Card</div>${t.raw && !t.card ? `<p class="foot" style="margin:0 16px 6px">Wallet sent “${esc(t.raw)}”.</p>` : ''}${cardChips(s.card, 'None')}
      <button class="btn danger" style="margin-top:26px" data-act="deltx">Delete Transaction</button><div id="delconfirm"></div>`, '<button class="link bold" data-act="saveedit">Save</button>');
  },
  card(s) {
    const d = s.d;
    return sheetFrame(d.id ? 'Edit Card' : 'New Card', `<div class="pc" id="cprev" style="background:${esc(d.color)};margin:4px 0 16px;min-height:140px"><div class="top"><span id="cpn">${esc(d.name || 'Card name')}</span><span class="kind" id="cpt">${esc(d.type)}</span></div><div class="sub" id="cpl">•••• ${esc(d.last4 || '••••')}</div></div>
      ${s.alias ? `<p class="foot" style="margin:0 16px 8px">Wallet purchases from “${esc(s.alias)}” will be linked to this card.</p>` : ''}
      <div class="group"><label class="fl" for="cname"><span>Name</span><input class="t" id="cname" value="${esc(d.name)}" placeholder="Amex Cobalt"></label><label class="fl" for="clast"><span>Last 4</span><input class="t" id="clast" inputmode="numeric" maxlength="4" value="${esc(d.last4 || '')}" placeholder="1234"></label><label class="fl" for="climit"><span>Limit</span><input class="t" id="climit" inputmode="decimal" value="${d.limit ? esc(decimal(d.limit)) : ''}" placeholder="Optional monthly limit"></label></div>
      <div class="sec">Type</div><div class="seg"><button type="button" data-ctype="credit" aria-pressed="${d.type === 'credit'}">Credit</button><button type="button" data-ctype="debit" aria-pressed="${d.type === 'debit'}">Debit</button></div>
      <div class="sec">Color</div><div class="chips w">${SWATCHES.map((c) => `<button type="button" class="swatch" data-color="${c}" aria-label="Color ${c}" aria-pressed="${d.color === c}" style="background:${c}"></button>`).join('')}</div>
      ${d.id ? `<div class="group" style="margin-top:20px"><div class="cell"><span class="grow">Archived<div class="faint small">Hide from the dashboard and quick entry</div></span>${sw('carch', d.archived, 'Archived')}</div></div><button class="btn danger" style="margin-top:20px" data-act="delcard">Delete Card</button><div id="delconfirm"></div>` : ''}`, '<button class="link bold" data-act="savecard">Save</button>');
  },
  cardslist() {
    return sheetFrame('Cards', `${S.cards.length ? `<div class="group">${S.cards.map((c) => `<button class="cell chev" data-act="opencard" data-v="${esc(c.id)}" style="${c.archived ? 'opacity:.5' : ''}"><span style="width:44px;height:28px;border-radius:5px;background:${esc(c.color)};flex:none"></span><span class="grow"><div>${esc(c.name)}${c.archived ? ' (archived)' : ''}</div><div class="faint small">${c.type === 'credit' ? 'Credit' : 'Debit'}${c.last4 ? ' ·· ' + esc(c.last4) : ''}${c.limit ? ' · limit ' + money(c.limit, { compact: true }) : ''}</div></span></button>`).join('')}</div>` : '<div class="empty">Add the cards you pay with. Use the names Apple Wallet shows so purchases match automatically.</div>'}
      <button class="btn" style="margin-top:16px" data-act="newcard">Add Card</button>`);
  },
  linkcard(s) {
    return sheetFrame('Link Card', `<p class="muted" style="margin:4px 4px 12px">Apple Wallet calls this card “${esc(s.alias)}”. Which card is it? You’ll only be asked once.</p>${activeCards().length ? `<div class="group">${activeCards().map((c) => `<button class="cell chev" data-act="dolink" data-v="${esc(c.id)}"><span class="dot" style="background:${esc(c.color)};width:14px;height:14px"></span><span class="grow">${esc(c.name)}${c.last4 ? ' ·' + esc(c.last4) : ''}</span></button>`).join('')}</div>` : ''}<button class="btn alt" style="margin-top:16px" data-act="newcardalias">Create a new card</button>`);
  },
  budgets() {
    return sheetFrame('Monthly Budgets', `<div class="group">${S.cats.map((c) => `<label class="fl" for="b-${esc(c.id)}"><span class="ell">${esc(c.icon)} ${esc(c.name)}</span><input class="t" id="b-${esc(c.id)}" data-bud="${esc(c.id)}" inputmode="decimal" style="text-align:right;padding-right:16px" value="${esc(decimal(S.budgets[c.id] || 0))}"></label>`).join('')}</div><p class="foot">Budgets repeat every month. You’ll see a warning at 80% and 100%.</p>
      <div class="sec">New category</div><div class="group"><label class="fl" for="ncname"><span>Name</span><input class="t" id="ncname" placeholder="e.g. Pets"></label><label class="fl" for="ncicon"><span>Emoji</span><input class="t" id="ncicon" placeholder="🐶" maxlength="4"></label><label class="fl" for="ncbud"><span>Budget</span><input class="t" id="ncbud" inputmode="decimal" placeholder="0.00"></label></div>`, '<button class="link bold" data-act="savebudgets">Save</button>');
  },
  filters() {
    const f = S.search;
    return sheetFrame('Filter', `<div class="sec">Card</div><div class="chips w"><button class="chip" data-f="card" data-v="" aria-pressed="${!f.card}">Any</button>${S.cards.map((c) => `<button class="chip" data-f="card" data-v="${esc(c.id)}" aria-pressed="${f.card === c.id}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</button>`).join('')}<button class="chip" data-f="card" data-v="none" aria-pressed="${f.card === 'none'}">No card</button></div>
      <div class="sec">Category</div><div class="chips w"><button class="chip" data-f="cat" data-v="" aria-pressed="${!f.cat}">Any</button>${S.cats.map((c) => `<button class="chip" data-f="cat" data-v="${esc(c.id)}" aria-pressed="${f.cat === c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div>
      <div class="sec">Date range</div><div class="group"><label class="fl" for="ffrom"><span>From</span><input class="t" id="ffrom" type="date" value="${esc(f.from)}"></label><label class="fl" for="fto"><span>To</span><input class="t" id="fto" type="date" value="${esc(f.to)}"></label></div>
      <button class="btn alt" style="margin-top:20px" data-act="resetf">Reset filters</button>`, '<button class="link bold" data-act="close">Done</button>');
  },
  rules() {
    const mine = S.rules.filter((r) => r.s === 'user'), builtIn = S.rules.length - mine.length;
    return sheetFrame('Auto-categorize', `<p class="muted" style="margin:4px 4px 12px">When a merchant name contains a keyword, it gets that category. Your rules, including fixes you make on a transaction, win over the ${builtIn} built-in ones.</p>
      <div class="group"><label class="fl" for="rk"><span>Keyword</span><input class="t" id="rk" placeholder="e.g. farmers market"></label><label class="fl" for="rc"><span>Category</span><select class="t" id="rc"><option value="">Choose…</option>${S.cats.map((c) => `<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label></div>
      <button class="btn" style="margin-top:12px" data-act="addrule">Add Rule</button>
      <div class="sec">Your rules (${mine.length})</div><div class="group">${mine.length ? mine.map((r) => `<div class="cell"><code class="grow ell">${esc(r.k)}</code><span class="faint small">${esc(catById(r.c)?.name || '—')}</span><button class="link danger" data-act="delrule" data-v="${esc(r.id)}" aria-label="Delete rule ${esc(r.k)}">✕</button></div>`).join('') : '<div class="cell faint">None yet. Change a transaction’s category and it’s remembered here.</div>'}</div>`);
  },
  wallet(s) {
    const tok = S.user.api_token || '';
    return sheetFrame('Connect Apple Wallet', `<p class="muted" style="margin:4px 4px 10px">An iPhone Shortcuts automation sends each Apple Pay tap here in the background. Nothing opens on your phone.</p>
      <div class="banner warn"><span aria-hidden="true">ⓘ</span><span class="small">Only <strong>Apple Pay taps</strong> are captured. Online card-number purchases, card swipes and pre-authorized bills need <strong>＋</strong> quick entry or a bank CSV import.</span></div>
      <div class="sec">Your endpoint</div><div class="group">
        <div style="padding:12px 16px"><div class="row" style="margin-bottom:6px"><span class="faint small grow">URL</span><button class="link bold" data-act="copyurl">Copy</button></div><div class="code">${esc(WALLET_URL)}</div></div>
        <div style="padding:12px 16px;border-top:.5px solid var(--sep)"><div class="row" style="margin-bottom:6px"><span class="faint small grow">X-Api-Key</span><button class="link" data-act="showtok">${s.show ? 'Hide' : 'Show'}</button><button class="link bold" data-act="copytok">Copy</button></div><div class="code" id="tok">${esc(s.show ? tok : '•'.repeat(24) + tok.slice(-4))}</div></div>
      </div>
      <div class="group" style="margin-top:12px">
        <div class="cell"><span class="grow">Last transaction received</span><span class="small" style="color:${S.user.last_wallet_at ? 'var(--good)' : 'var(--text-3)'}">${S.user.last_wallet_at ? '● ' + esc(ago(S.user.last_wallet_at)) : 'Waiting…'}</span></div>
        <button class="cell" data-act="testwallet"><span class="grow" style="color:var(--accent)">Send test transaction</span></button>
        <button class="cell" data-act="regen"><span class="grow" style="color:var(--bad)">Regenerate key</span></button>
      </div><div id="walletmsg"></div><div id="regenconfirm"></div>
      <p class="foot">The test uses your key exactly like the Shortcut does, but nothing is saved.</p>
      <div class="sec">Set up the automation (about 2 minutes)</div><ol class="steps group">
        <li><b>Open Shortcuts → Automation</b>Tap <span class="kbd">＋</span> (or <span class="kbd">New Automation</span>), then scroll the list of triggers, or use the search box, and choose <span class="kbd">Transaction</span>. Needs iOS 17 or later.</li>
        <li><b>Pick your cards</b>Select the Wallet cards to track. Leave Category and Merchant as <em>Any</em>. Choose <span class="kbd">Run Immediately</span>, turn off <em>Notify When Run</em>, then <span class="kbd">Next</span> → <span class="kbd">New Blank Automation</span>.</li>
        <li><b>Add “Get Contents of URL”</b>Tap <span class="kbd">Add Action</span>, search <em>Get Contents of URL</em>, add it, and paste your endpoint URL into the URL field.</li>
        <li><b>Set method and key</b>Tap the <span class="kbd">›</span> arrow. Set <em>Method</em> to <span class="kbd">POST</span>. Under <em>Headers</em> tap <span class="kbd">Add new header</span>: key <code>X-Api-Key</code>, value = your key.</li>
        <li><b>Build the JSON body</b>Set <em>Request Body</em> to <span class="kbd">JSON</span>, then <span class="kbd">Add new field → Text</span> three times: <code>amount</code> = Shortcut Input → <em>Amount</em>, <code>merchant</code> = Shortcut Input → <em>Merchant</em>, <code>card</code> = Shortcut Input → <em>Card or Pass</em>. To insert one, tap the value, choose <em>Shortcut Input</em> above the keyboard, then tap the token and pick the property.</li>
        <li><b>Done</b>Tap <span class="kbd">Done</span>. Your next Apple Pay tap shows up here within seconds.</li>
      </ol>
      <p class="foot">Duplicates (same amount, merchant and card within 60 seconds) are ignored. New card names show a banner on the Cards tab so you can link them once.</p>`);
  },
  import(s) { return sheetFrame('Import CSV', `<p class="muted" style="margin:4px 4px 12px">Download a CSV from your bank’s website, then choose it. Rows that match purchases already logged are skipped.</p><label class="btn alt" for="csvfile" style="cursor:pointer" id="csvlabel">${s.name ? '📄 ' + esc(s.name) : 'Choose CSV file'}</label><input type="file" id="csvfile" accept=".csv,text/csv" hidden><div id="csvmap"></div>`); },
};

const SHEET_INIT = {
  add(s) {
    const root = $('#sheet-root'), amt = $('#amt'), merch = $('#merch'), save = $('#addsave');
    const ok = () => { save.disabled = !(parseCents(amt.value) > 0 && merch.value.trim()); };
    amt.addEventListener('input', () => { amt.value = amt.value.replace(/[^0-9.,]/g, ''); ok(); });
    merch.addEventListener('input', ok);
    root.querySelectorAll('[data-recent]').forEach((b) => b.addEventListener('click', () => {
      merch.value = b.dataset.recent;
      if (b.dataset.cat) { s.cat = b.dataset.cat; root.querySelectorAll('[data-pick="cat"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === s.cat))); }
      ok();
    }));
    wirePickers(root, s);
    $('#addf').addEventListener('submit', (e) => { e.preventDefault(); submitAdd(); });
    amt.focus();
  },
  edit(s) { s.onPick = (k) => { if (k === 'cat') $('#simrow').hidden = !(s.cat && s.cat !== s.tx.cat); }; wirePickers($('#sheet-root'), s); },
  card(s) {
    const root = $('#sheet-root'), d = s.d;
    $('#cname').addEventListener('input', (e) => { d.name = e.target.value; $('#cpn').textContent = d.name || 'Card name'; });
    $('#clast').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); d.last4 = e.target.value; $('#cpl').textContent = '•••• ' + (d.last4 || '••••'); });
    root.querySelectorAll('[data-ctype]').forEach((b) => b.addEventListener('click', () => { d.type = b.dataset.ctype; root.querySelectorAll('[data-ctype]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#cpt').textContent = d.type; }));
    root.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => { d.color = b.dataset.color; root.querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#cprev').style.background = d.color; }));
  },
  filters() {
    const root = $('#sheet-root');
    root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { S.search[b.dataset.f] = b.dataset.v; root.querySelectorAll(`[data-f="${b.dataset.f}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); runActivitySearch(); render(); }));
    $('#ffrom').addEventListener('change', (e) => { S.search.from = e.target.value; runActivitySearch(); render(); });
    $('#fto').addEventListener('change', (e) => { S.search.to = e.target.value; runActivitySearch(); render(); });
  },
  import(s) { $('#csvfile').addEventListener('change', (e) => readCsv(e.target.files?.[0], s)); if (s.rows) renderCsvMap(s); },
};

/* ───────────── actions ───────────── */
function submitAdd() {
  const s = S.sheet, cents = parseCents($('#amt').value), merchant = $('#merch').value.trim();
  if (!(cents > 0) || !merchant) return;
  const at = $('#when').value ? new Date($('#when').value).toISOString() : new Date().toISOString();
  const id = uuid();
  const tx = { id, client_id: id, cents, merchant, key: mKey(merchant), card: s.card || null, raw: null, cat: s.cat || categorize(merchant), at, note: $('#note').value.trim(), src: 'manual' };
  if (s.card) LS.set('pl-last-card', s.card);
  closeSheet(); insertTx(tx); toast('Expense added'); checkAlerts(tx);
}
async function saveEdit() {
  const s = S.sheet, t = s.tx, cents = parseCents($('#eamt').value), merchant = $('#emerch').value.trim();
  if (!cents || !merchant) return toast('Enter an amount and a merchant.');
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
      msg = `Saved. Future “${merchant}” purchases will be ${catById(s.cat)?.name}.`;
    }
    if (similar) {
      const upd = await must(sb.from('transactions').update({ category_id: s.cat }).eq('merchant_key', next.key).neq('id', t.id).select('id'));
      if (upd.length) { msg += ` ${upd.length} more updated.`; await loadMonth(S.month); if (S.tab === 'activity') runActivitySearch(); }
    }
  } catch (e) { msg = 'Saved, but the rule could not be stored: ' + errText(e); }
  render(); toast(msg);
}
async function saveCard() {
  const s = S.sheet, d = s.d;
  d.name = $('#cname').value.trim(); d.last4 = $('#clast').value.trim() || null;
  if (!d.name) return toast('Give the card a name.');
  if (d.last4 && !/^\d{4}$/.test(d.last4)) return toast('Last 4 must be four digits.');
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
    closeSheet(); if (attached) await loadMonth(S.month); render();
    toast(d.id ? 'Card saved' : `Card added${attached ? ` · ${attached} Wallet purchase${attached === 1 ? '' : 's'} linked` : ''}`);
  } catch (e) { toast(errText(e)); }
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
  try { const n = await linkAlias(alias, cardId); closeSheet(); await loadMonth(S.month); render(); toast(`Linked “${alias}” · ${n} transaction${n === 1 ? '' : 's'} updated`); }
  catch (e) { toast(errText(e)); }
}
async function saveBudgets() {
  try {
    const rows = [];
    document.querySelectorAll('[data-bud]').forEach((i) => { const c = parseCents(i.value || '0'); if (c !== null && c >= 0) rows.push({ user_id: S.uid, category_id: i.dataset.bud, amount_cents: c, updated_at: new Date().toISOString() }); });
    if (rows.length) await must(sb.from('budgets').upsert(rows, { onConflict: 'category_id' }));
    rows.forEach((r) => (S.budgets[r.category_id] = r.amount_cents));
    const name = $('#ncname').value.trim();
    if (name) {
      if (S.cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast('That category already exists.');
      const cat = await must(sb.from('categories').insert({ user_id: S.uid, name: name.slice(0, 40), icon: $('#ncicon').value.trim() || '•', color: SWATCHES[S.cats.length % SWATCHES.length], sort: S.cats.length + 1 }).select('id,name,icon,color,sort,is_fallback').single());
      const amount = Math.max(0, parseCents($('#ncbud').value || '0') || 0);
      await must(sb.from('budgets').insert({ user_id: S.uid, category_id: cat.id, amount_cents: amount }));
      S.cats.push(cat); S.budgets[cat.id] = amount;
    }
    closeSheet(); snapshot(); render(); toast('Budgets saved');
  } catch (e) { toast(errText(e)); }
}
async function testWallet() {
  const box = $('#walletmsg'); box.innerHTML = '<p class="foot">Sending…</p>';
  const card = activeCards()[0]?.name || 'My Visa';
  try {
    const res = await fetch(WALLET_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': S.user.api_token }, body: JSON.stringify({ amount: '$4.25', merchant: 'Test Coffee Shop', card, test: true }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The endpoint answered ${res.status}. Is the wallet function deployed?`);
    const p = data.parsed || {};
    box.innerHTML = `<p class="foot" style="color:var(--good);font-weight:500">✓ Connection works. ${esc(money(p.amount_cents || 0))} at ${esc(p.merchant)} → ${p.card_matched ? `matched “${esc(p.card)}”` : `“${esc(p.card)}” not matched yet`}.</p>`;
  } catch (e) {
    box.innerHTML = `<p class="foot" style="color:var(--bad);font-weight:500">✕ ${esc(isNetErr(e) ? 'Couldn’t reach the endpoint. Check the wallet function is deployed with JWT verification off.' : e.message)}</p>`;
  }
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
  } catch (e) { toast(errText(e)); }
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
async function readCsv(file, s) {
  if (!file) return;
  const rows = parseCsv(await file.text());
  if (!rows.length) return toast('That file has no rows.');
  const first = rows[0], header = first.every((c) => !/^\s*-?\$?\d[\d,.]*\s*$/.test(c)) && !first.some((c) => /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(c));
  const h = header ? first.map((x) => x.toLowerCase()) : [];
  const find = (...res) => { for (const re of res) { const i = h.findIndex((x) => re.test(x)); if (i >= 0) return i; } return -1; };
  const map = header ? { date: find(/date|posted/), merch: find(/description|merchant|payee|name|details|memo/), amount: find(/amount|value/), debit: find(/debit|withdraw|money out/), credit: find(/credit|deposit|money in/) } : { date: 0, merch: 1, amount: 2, debit: first.length > 3 ? 2 : -1, credit: first.length > 3 ? 3 : -1 };
  const body = header ? rows.slice(1) : rows;
  const order = body.slice(0, 60).some((r) => +(String(r[map.date] || '').match(/^(\d{1,2})[/.-]/)?.[1] || 0) > 12) ? 'dmy' : 'mdy';
  Object.assign(s, { name: file.name, rows, header, map, mode: map.amount < 0 && map.debit >= 0 ? 'split' : !header && first.length >= 4 ? 'split' : 'single', neg: false, order, card: '' });
  $('#csvlabel').textContent = '📄 ' + file.name;
  renderCsvMap(s);
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
function renderCsvMap(s) {
  const cols = s.header ? s.rows[0] : s.rows[0].map((_, i) => 'Column ' + (i + 1)), sample = (s.header ? s.rows[1] : s.rows[0]) || [];
  const sel = (label, k) => `<label class="fl" for="m-${k}"><span>${label}</span><select class="t" id="m-${k}" data-map="${k}"><option value="-1">—</option>${cols.map((c, i) => `<option value="${i}" ${s.map[k] === i ? 'selected' : ''}>${esc(c || 'Column ' + (i + 1))}${sample[i] ? ' (e.g. ' + esc(String(sample[i]).slice(0, 22)) + ')' : ''}</option>`).join('')}</select></label>`;
  const m = csvMapped(s), valid = m.filter((x) => x.date && x.merchant && x.cents);
  $('#csvmap').innerHTML = `<div class="sec">Columns</div><div class="group"><div class="cell"><span class="grow">First row is a header</span>${sw('csvh', s.header, 'First row is a header')}</div>${sel('Date', 'date')}${sel('Merchant', 'merch')}</div>
    <div class="sec">Amount</div><div class="seg"><button type="button" data-mode="single" aria-pressed="${s.mode === 'single'}">One column</button><button type="button" data-mode="split" aria-pressed="${s.mode === 'split'}">Debit / Credit</button></div>
    <div class="group" style="margin-top:8px">${s.mode === 'single' ? sel('Amount', 'amount') + `<div class="cell"><span class="grow">Expenses are negative</span>${sw('csvneg', s.neg, 'Expenses are negative numbers')}</div>` : sel('Debit', 'debit') + sel('Credit', 'credit')}</div>
    <div class="sec">Options</div><div class="group"><label class="fl" for="csvorder"><span>Dates</span><select class="t" id="csvorder"><option value="mdy" ${s.order === 'mdy' ? 'selected' : ''}>MM/DD/YYYY</option><option value="dmy" ${s.order === 'dmy' ? 'selected' : ''}>DD/MM/YYYY</option></select></label><label class="fl" for="csvcard"><span>Card</span><select class="t" id="csvcard"><option value="">None</option>${S.cards.map((c) => `<option value="${esc(c.id)}" ${s.card === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="sec">Preview · ${valid.length} of ${m.length} rows readable</div><div class="group">${m.slice(0, 6).map((x) => `<div class="cell" style="${x.date && x.merchant && x.cents ? '' : 'opacity:.45'}"><span class="faint num small" style="width:84px;flex:none">${x.date ? esc(localInput(x.date).slice(0, 10)) : '??'}</span><span class="grow ell">${esc(x.merchant || '—')}</span><span class="amt-col ${x.cents < 0 ? 'refund' : ''}">${x.cents ? money(x.cents) : '—'}</span></div>`).join('')}</div>
    <p class="foot">Positive amounts are spending, negative are refunds or payments. Check the signs look right.</p>
    <button class="btn" style="margin-top:14px" data-act="doimport" ${valid.length ? '' : 'disabled'}>Import ${valid.length} rows</button>`;
  const root = $('#csvmap');
  root.querySelectorAll('[data-map]').forEach((el) => el.addEventListener('change', () => { s.map[el.dataset.map] = +el.value; renderCsvMap(s); }));
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { s.mode = b.dataset.mode; renderCsvMap(s); }));
  $('#csvh').addEventListener('change', (e) => { s.header = e.target.checked; renderCsvMap(s); });
  $('#csvneg')?.addEventListener('change', (e) => { s.neg = e.target.checked; renderCsvMap(s); });
  $('#csvorder').addEventListener('change', (e) => { s.order = e.target.value; renderCsvMap(s); });
  $('#csvcard').addEventListener('change', (e) => { s.card = e.target.value; });
}
async function doImport(btn) {
  const s = S.sheet, valid = csvMapped(s).filter((x) => x.date && x.merchant && x.cents);
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
    closeSheet(); await loadMonth(S.month); render(); toast(`Imported ${rows.length} · skipped ${dup} already logged`);
  } catch (e) { btn.disabled = false; btn.textContent = 'Try again'; toast(errText(e)); }
}

/* ───────────── events ───────────── */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const v = el.dataset.v, act = el.dataset.act;
  const A = {
    tab: () => { S.tab = v; S.sheet = null; window.scrollTo(0, 0); if (v === 'activity' && S.activity === null) runActivitySearch(); render(); },
    add: () => { const last = LS.get('pl-last-card', null); openSheet({ type: 'add', card: activeCards().some((c) => c.id === last) ? last : activeCards()[0]?.id || null, cat: null }); },
    submitadd: submitAdd,
    close: closeSheet,
    month: async () => { S.month = shiftYm(S.month, +v); S.pickedDay = null; S.picked = null; render(); if (!S.txByMonth[S.month]) { try { await loadMonth(S.month); } catch (err) { toast(errText(err)); } render(); } else refresh(); },
    pick: () => { S.picked = S.picked === v ? null : v; render(); },
    day: () => { S.pickedDay = S.pickedDay === +v ? null : +v; render(); },
    edit: () => { const t = findTx(v); if (t) openSheet({ type: 'edit', tx: t, cat: t.cat, card: t.card }); },
    saveedit: saveEdit,
    deltx: () => { $('#delconfirm').innerHTML = `<div class="row" style="margin-top:10px"><button class="btn alt" data-act="nodel">Keep</button><button class="btn" style="background:var(--bad)" data-act="yesdeltx">Delete</button></div>`; },
    nodel: () => { $('#delconfirm').innerHTML = ''; },
    yesdeltx: () => { const t = S.sheet.tx; closeSheet(); deleteTx(t); toast('Deleted'); },
    newcard: () => openSheet({ type: 'card', d: { name: '', last4: '', color: SWATCHES[S.cards.length % SWATCHES.length], type: 'credit', limit: null, archived: false } }),
    newcardalias: () => { const alias = S.sheet.alias; openSheet({ type: 'card', alias, d: { name: alias, last4: '', color: SWATCHES[S.cards.length % SWATCHES.length], type: 'credit', limit: null, archived: false } }); },
    opencard: () => { const c = cardById(v); if (c) openSheet({ type: 'card', d: { ...c } }); },
    savecard: saveCard,
    delcard: () => { $('#delconfirm').innerHTML = `<p class="foot">Transactions on this card are kept and become unassigned.</p><div class="row" style="margin-top:8px"><button class="btn alt" data-act="nodel">Keep</button><button class="btn" style="background:var(--bad)" data-act="yesdelcard">Delete</button></div>`; },
    yesdelcard: async () => { const id = S.sheet.d.id; try { await must(sb.from('cards').delete().eq('id', id)); S.cards = S.cards.filter((c) => c.id !== id); for (const [k, cid] of Object.entries(S.aliases)) if (cid === id) delete S.aliases[k]; closeSheet(); await loadMonth(S.month); render(); toast('Card deleted'); } catch (err) { toast(errText(err)); } },
    cardslist: () => openSheet({ type: 'cardslist' }),
    linkcard: () => openSheet({ type: 'linkcard', alias: v }),
    dolink: () => doLink(v),
    editbudgets: () => openSheet({ type: 'budgets' }),
    savebudgets: saveBudgets,
    filters: () => openSheet({ type: 'filters' }),
    resetf: () => { Object.assign(S.search, { card: '', cat: '', from: '', to: '' }); openSheet({ type: 'filters' }); runActivitySearch(); render(); },
    clearf: () => { if (v === 'date') { S.search.from = ''; S.search.to = ''; } else S.search[v] = ''; runActivitySearch(); render(); },
    rules: () => openSheet({ type: 'rules' }),
    addrule: async () => {
      const k = normM($('#rk').value).slice(0, 100), c = $('#rc').value;
      if (k.length < 2 || !c) return toast('Enter a keyword (2+ letters) and pick a category.');
      try { const row = await must(sb.from('merchant_rules').upsert({ user_id: S.uid, keyword: k, category_id: c, source: 'user' }, { onConflict: 'user_id,keyword' }).select().single()); S.rules = [{ id: row.id, k, c, s: 'user' }, ...S.rules.filter((r) => r.k !== k)]; openSheet({ type: 'rules' }); toast('Rule added'); } catch (err) { toast(errText(err)); }
    },
    delrule: async () => { try { await must(sb.from('merchant_rules').delete().eq('id', v)); S.rules = S.rules.filter((r) => r.id !== v); openSheet({ type: 'rules' }); } catch (err) { toast(errText(err)); } },
    wallet: () => openSheet({ type: 'wallet', show: false }),
    copyurl: () => copy(WALLET_URL),
    copytok: () => copy(S.user.api_token),
    showtok: () => { S.sheet.show = !S.sheet.show; $('#tok').textContent = S.sheet.show ? S.user.api_token : '•'.repeat(24) + S.user.api_token.slice(-4); el.textContent = S.sheet.show ? 'Hide' : 'Show'; },
    testwallet: testWallet,
    regen: () => { $('#regenconfirm').innerHTML = `<p class="foot">Your Shortcut stops working until you paste the new key into it.</p><div class="row" style="margin-top:8px"><button class="btn alt" data-act="noregen">Keep current key</button><button class="btn" style="background:var(--bad)" data-act="yesregen">Regenerate</button></div>`; },
    noregen: () => { $('#regenconfirm').innerHTML = ''; },
    yesregen: async () => { try { const tok = await must(sb.rpc('regenerate_api_token')); S.user.api_token = tok; openSheet({ type: 'wallet', show: true }); toast('New key generated. Update your Shortcut.'); } catch (err) { toast(errText(err)); } },
    import: () => openSheet({ type: 'import' }),
    doimport: () => doImport(el),
    export: exportCsv,
    dismissinstall: () => { LS.set('pl-install-dismissed', Date.now()); render(); },
    loginstep: () => { Object.assign(S.login, { step: v, error: '' }); render(); },
    signout: async () => { await sb.auth.signOut(); LS.del('pl-snapshot'); LS.del('pl-queue'); location.reload(); },
  };
  A[act]?.();
});
document.addEventListener('input', (e) => { if (e.target.id === 'q') { S.search.q = e.target.value; runActivitySearch(); } });
document.addEventListener('change', async (e) => {
  if (e.target.id === 'currency') {
    const cur = e.target.value;
    try { await must(sb.from('users').update({ currency: cur }).eq('id', S.uid)); S.user.currency = cur; snapshot(); render(); } catch (err) { toast(errText(err)); }
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet) closeSheet(); });
window.addEventListener('online', () => { S.online = true; flushQueue(); refresh(); render(); });
window.addEventListener('offline', () => { S.online = false; render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { flushQueue(); refresh(); } });
setInterval(() => { if (document.visibilityState === 'visible' && S.session) refresh(); }, 30000);

/* ───────────── boot ───────────── */
async function start(session) {
  if (S.login.step === 'newpass') return;
  S.session = session; S.uid = session?.user?.id || null; S.email = session?.user?.email || '';
  if (!S.uid) { S.ready = true; render(); return; }
  if (restoreSnapshot()) { S.ready = true; render(); }
  try { await loadAll(); S.ready = true; S.note = ''; flushQueue(); }
  catch (e) { S.ready = true; S.note = isNetErr(e) ? '' : 'Couldn’t load your data: ' + (e.message || e) + '. Did the database setup run?'; }
  render();
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
