import type { NextRequest } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import { requireUser, json } from '@/lib/http';
import { RP_NAME, challengeCookie, relyingParty, storeChallenge } from '@/lib/webauthn';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const { user, supabase } = auth;
  const { rpID } = relyingParty(req);
  const { data: existing } = await supabase.from('passkeys').select('id,transports');

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email ?? user.id,
    userID: isoUint8Array.fromUTF8String(user.id),
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map((p) => ({ id: p.id, transports: (p.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const id = await storeChallenge(options.challenge, 'register', user.id);
  const res = json(options);
  res.cookies.set(challengeCookie(id));
  return res;
}
