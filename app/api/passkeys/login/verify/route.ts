import type { NextRequest } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { fail, json, readJson } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { CHALLENGE_COOKIE, challengeCookie, consumeChallenge, relyingParty } from '@/lib/webauthn';

/**
 * Verify a passkey assertion, then mint a normal Supabase session for that user:
 * generate a one-time magic-link token server-side and redeem it immediately, which
 * sets the regular Supabase auth cookies. The token never leaves the server.
 */
export async function POST(req: NextRequest) {
  const body = await readJson<{ response?: { id?: string } }>(req);
  const credId = body?.response?.id;
  if (!credId) return fail(400, 'Missing passkey response');
  const stored = await consumeChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value, 'login');
  if (!stored) return fail(400, 'Sign-in request expired. Try again.');

  const db = supabaseAdmin();
  const { data: pk } = await db.from('passkeys').select('*').eq('id', credId).maybeSingle();
  if (!pk) return fail(401, 'This passkey is not registered. Sign in with email, then add a passkey in Settings.');
  const { rpID, origin } = relyingParty(req);

  let newCounter: number;
  try {
    const v = await verifyAuthenticationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: body!.response as any,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: pk.id,
        publicKey: isoBase64URL.toBuffer(pk.public_key),
        counter: Number(pk.counter),
        transports: (pk.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
      },
    });
    if (!v.verified) return fail(401, 'Passkey verification failed');
    newCounter = v.authenticationInfo.newCounter;
  } catch (e) {
    return fail(401, (e as Error).message);
  }
  await db.from('passkeys').update({ counter: newCounter, last_used_at: new Date().toISOString() }).eq('id', pk.id);

  const { data: u } = await db.from('users').select('email').eq('id', pk.user_id).single();
  if (!u?.email) return fail(500, 'Account has no email');
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email: u.email });
  if (linkErr || !link.properties?.hashed_token) return fail(500, 'Could not start session');

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token });
  if (error) return fail(500, error.message);
  const res = json({ ok: true });
  res.cookies.set({ ...challengeCookie(''), maxAge: 0 });
  return res;
}
