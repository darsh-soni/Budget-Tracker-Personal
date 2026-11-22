import 'server-only';
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabase/admin';

export const RP_NAME = 'Pocket Ledger';
export const CHALLENGE_COOKIE = 'pl_webauthn';

/** Relying party derived from NEXT_PUBLIC_APP_URL, falling back to the request's own origin. */
export function relyingParty(req: NextRequest): { rpID: string; origin: string } {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const origin = configured ? new URL(configured).origin : req.nextUrl.origin;
  return { rpID: new URL(origin).hostname, origin };
}

export async function storeChallenge(challenge: string, kind: 'register' | 'login', userId: string | null) {
  const db = supabaseAdmin();
  // opportunistic cleanup of expired challenges
  await db.from('webauthn_challenges').delete().lt('expires_at', new Date().toISOString());
  const { data, error } = await db.from('webauthn_challenges').insert({ challenge, kind, user_id: userId }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Fetch and delete (single use) a stored challenge. */
export async function consumeChallenge(id: string | undefined, kind: 'register' | 'login') {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = supabaseAdmin();
  const { data } = await db.from('webauthn_challenges').delete().eq('id', id).eq('kind', kind).select().maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as { challenge: string; user_id: string | null };
}

export const challengeCookie = (id: string) => ({
  name: CHALLENGE_COOKIE,
  value: id,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/passkeys',
  maxAge: 300,
});
