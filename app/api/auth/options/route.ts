import { isDemoMode } from '@/lib/server/auth/session';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ demoMode: isDemoMode() }, { headers: { 'cache-control': 'no-store' } });
}
