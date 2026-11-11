import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { jsonResponse, route } from '@/lib/server/http/responses';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

/** Liveness probe. Reports database reachability without exposing internals. */
export const GET = route(async () => {
  try {
    await getDb().run(sql`select 1`);
    return jsonResponse({ status: 'ok', database: 'up' });
  } catch (error) {
    console.error('[health] database unreachable:', error);
    return jsonResponse({ status: 'degraded', database: 'down' }, 503);
  }
});
