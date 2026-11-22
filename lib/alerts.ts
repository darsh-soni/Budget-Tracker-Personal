import 'server-only';
import webpush from 'web-push';
import { supabaseAdmin } from './supabase/admin';
import { env } from './env';
import { monthKey, monthRange, safeTimeZone } from './dates';
import { formatCents } from './money';

let configured = false;
function configure(): boolean {
  if (configured) return true;
  if (!env.vapidPublic() || !env.vapidPrivate()) return false;
  webpush.setVapidDetails(env.vapidSubject(), env.vapidPublic(), env.vapidPrivate());
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Send a push to every subscribed device of a user; prunes expired subscriptions. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!configure()) return 0;
  const db = supabaseAdmin();
  const { data: subs } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', userId);
  let sent = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24, urgency: 'normal' },
        );
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
        else console.error('push failed', code);
      }
    }),
  );
  return sent;
}

const THRESHOLDS = [100, 80] as const;

/**
 * After a transaction lands, check its category budget and card limit for that month and
 * notify once per threshold (80 %, 100 %) per month.
 */
export async function checkBudgetAlerts(
  userId: string,
  opts: { categoryId: string | null; cardId: string | null; occurredAt: Date },
): Promise<void> {
  if (!configure()) return;
  const db = supabaseAdmin();
  const { data: user } = await db.from('users').select('timezone,currency').eq('id', userId).single();
  if (!user) return;
  const tz = safeTimeZone(user.timezone);
  const month = monthKey(opts.occurredAt, tz);
  const { start, end } = monthRange(month, tz);

  const checks: { kind: 'category' | 'card'; id: string; label: string; limit: number }[] = [];
  if (opts.categoryId) {
    const [{ data: cat }, { data: budget }] = await Promise.all([
      db.from('categories').select('name').eq('id', opts.categoryId).single(),
      db.from('budgets').select('amount_cents').eq('category_id', opts.categoryId).maybeSingle(),
    ]);
    if (cat && budget && budget.amount_cents > 0) checks.push({ kind: 'category', id: opts.categoryId, label: `${cat.name} budget`, limit: budget.amount_cents });
  }
  if (opts.cardId) {
    const { data: card } = await db.from('cards').select('name,monthly_limit_cents').eq('id', opts.cardId).single();
    if (card?.monthly_limit_cents) checks.push({ kind: 'card', id: opts.cardId, label: `${card.name} limit`, limit: card.monthly_limit_cents });
  }

  for (const c of checks) {
    const { data: rows } = await db
      .from('transactions')
      .select('amount_cents')
      .eq('user_id', userId)
      .eq(c.kind === 'category' ? 'category_id' : 'card_id', c.id)
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', end.toISOString());
    const spent = (rows ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);
    const pct = (spent / c.limit) * 100;
    const hit = THRESHOLDS.find((t) => pct >= t);
    if (!hit) continue;
    // insert-once guard: a conflict means we already sent this threshold this month
    const { error } = await db
      .from('budget_alerts')
      .insert({ user_id: userId, kind: c.kind, ref_id: c.id, month, threshold: hit });
    if (error) continue;
    if (hit === 100) {
      // don't also send the 80 % one later this month
      await db.from('budget_alerts').upsert({ user_id: userId, kind: c.kind, ref_id: c.id, month, threshold: 80 }, { ignoreDuplicates: true });
    }
    const remaining = c.limit - spent;
    await sendPushToUser(userId, {
      title: hit === 100 ? `${c.label} exceeded` : `${Math.floor(pct)}% of ${c.label} used`,
      body:
        hit === 100
          ? `You're ${formatCents(-remaining, user.currency)} over for this month.`
          : `${formatCents(remaining, user.currency)} left of ${formatCents(c.limit, user.currency)} this month.`,
      url: c.kind === 'category' ? '/budget' : `/?card=${c.id}`,
      tag: `${c.kind}-${c.id}-${month}`,
    });
  }
}
