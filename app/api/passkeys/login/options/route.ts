import type { NextRequest } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { json } from '@/lib/http';
import { challengeCookie, relyingParty, storeChallenge } from '@/lib/webauthn';

/** Discoverable-credential login: no username needed, iOS shows Face ID with the saved passkey. */
export async function POST(req: NextRequest) {
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const id = await storeChallenge(options.challenge, 'login', null);
  const res = json(options);
  res.cookies.set(challengeCookie(id));
  return res;
}
