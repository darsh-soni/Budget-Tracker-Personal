import { fail, json, requireUser } from '@/lib/http';

/** POST /api/settings/token — regenerate the Shortcut API key (old one stops working immediately). */
export async function POST() {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { data, error } = await auth.supabase.rpc('regenerate_api_token');
  if (error) return fail(500, error.message);
  return json({ ok: true, api_token: data });
}
