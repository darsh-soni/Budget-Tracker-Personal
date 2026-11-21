import type { NextRequest } from 'next/server';
import { fail, json, readJson, requireUser } from '@/lib/http';
import { cleanText } from '@/lib/ingest';
import { safeTimeZone } from '@/lib/dates';

/** PATCH /api/settings { display_name?, currency?, timezone? } */
export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const body = await readJson(req);
  if (!body) return fail(400, 'Body must be JSON');
  const patch: Record<string, unknown> = {};
  if ('display_name' in body) patch.display_name = cleanText(body.display_name, 60);
  if ('currency' in body) {
    if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) return fail(422, 'Currency must be a 3-letter code');
    patch.currency = body.currency;
  }
  if ('timezone' in body && typeof body.timezone === 'string') {
    if (safeTimeZone(body.timezone) !== body.timezone) return fail(422, 'Unknown time zone');
    patch.timezone = body.timezone;
  }
  const { error } = await auth.supabase.from('users').update(patch).eq('id', auth.user.id);
  if (error) return fail(500, error.message);
  return json({ ok: true });
}
