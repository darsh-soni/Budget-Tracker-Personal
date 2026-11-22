import type { NextRequest } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { fail, json, readJson, requireUser } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CHALLENGE_COOKIE, challengeCookie, consumeChallenge, relyingParty } from '@/lib/webauthn';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const body = await readJson<{ response: unknown; deviceName?: string }>(req);
  const stored = await consumeChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value, 'register');
  if (!stored || stored.user_id !== auth.user.id) return fail(400, 'Passkey request expired. Try again.');
  const { rpID, origin } = relyingParty(req);

  try {
    const verification = await verifyRegistrationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: body?.response as any,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return fail(400, 'Passkey could not be verified');
    const { credential } = verification.registrationInfo;
    const { error } = await supabaseAdmin().from('passkeys').insert({
      id: credential.id,
      user_id: auth.user.id,
      public_key: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? null,
      device_name: typeof body?.deviceName === 'string' ? body.deviceName.slice(0, 60) : null,
    });
    if (error) return fail(500, error.message);
    const res = json({ ok: true });
    res.cookies.set({ ...challengeCookie(''), maxAge: 0 });
    return res;
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}
