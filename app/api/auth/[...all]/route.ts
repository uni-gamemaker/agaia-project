import { toNextJsHandler } from 'better-auth/next-js';
import { betterAuthInstance } from '@/lib/server/auth/better-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const { GET, POST } = toNextJsHandler(betterAuthInstance);
