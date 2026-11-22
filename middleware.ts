import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PAGES = ['/login', '/auth', '/offline'];

/** Refreshes the Supabase session cookie and redirects signed-out visitors to /login. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isApi = path.startsWith('/api/');
  const isPublic = PUBLIC_PAGES.some((p) => path === p || path.startsWith(p + '/'));
  if (!data.user && !isApi && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (data.user && path === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Skip static assets, the service worker, manifest, icons — and the Shortcut endpoint,
  // which authenticates with its own API key and should stay fast.
  matcher: ['/((?!_next/static|_next/image|sw\\.js|manifest\\.webmanifest|icons/|favicon\\.ico|api/transactions$).*)'],
};
