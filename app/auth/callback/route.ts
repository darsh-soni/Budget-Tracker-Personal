import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase/server';

/** Handles the link in the sign-in email (when opened in the same browser). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const supabase = await createSupabaseServer();
  const code = p.get('code');
  const tokenHash = p.get('token_hash');
  const type = (p.get('type') ?? 'email') as EmailOtpType;
  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  return NextResponse.redirect(new URL(ok ? '/' : '/login?error=link', req.url));
}
