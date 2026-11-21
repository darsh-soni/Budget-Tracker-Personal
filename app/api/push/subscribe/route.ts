import type { NextRequest } from 'next/server';
import { fail, json, readJson, requireUser } from '@/lib/http';

interface Sub { endpoint?: string; keys?: { p256dh?: string; auth?: string } }

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const body = await readJson<{ subscription?: Sub }>(req);
  const s = body?.subscription;
  if (!s?.endpoint?.startsWith('https://') || !s.keys?.p256dh || !s.keys.auth) return fail(422, 'Invalid subscription');
  const { error } = await auth.supabase.from('push_subscriptions').upsert(
    { user_id: auth.user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: req.headers.get('user-agent')?.slice(0, 300) },
    { onConflict: 'endpoint' },
  );
  if (error) return fail(500, error.message);
  return json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const body = await readJson<{ endpoint?: string }>(req);
  if (!body?.endpoint) return fail(422, 'endpoint required');
  await auth.supabase.from('push_subscriptions').delete().eq('endpoint', body.endpoint);
  return json({ ok: true });
}
