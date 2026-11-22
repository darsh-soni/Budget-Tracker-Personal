import type { NextRequest } from 'next/server';
import { fail, json, requireUser } from '@/lib/http';

export async function GET() {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { data } = await auth.supabase.from('passkeys').select('id,device_name,created_at,last_used_at').order('created_at');
  return json({ passkeys: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return fail(422, 'id required');
  const auth = await requireUser();
  if (auth.res) return auth.res;
  await auth.supabase.from('passkeys').delete().eq('id', id);
  return json({ ok: true });
}
