import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS — only use after authenticating the caller yourself. */
export function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(env.supabaseUrl(), env.serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
