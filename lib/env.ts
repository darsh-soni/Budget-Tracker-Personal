function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  serviceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  vapidPublic: () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
  vapidPrivate: () => process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: () => process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
};
