import { requirePrincipal } from '@/lib/server/auth/principal';
import { jsonResponse, route } from '@/lib/server/http/responses';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

/** Returns the identity resolved from the server-side session cookie. */
export const GET = route(async (req: Request) => {
  const principal = await requirePrincipal(req);
  return jsonResponse({ user: principal });
});
