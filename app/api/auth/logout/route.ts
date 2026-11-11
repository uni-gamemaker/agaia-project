import { NextResponse } from 'next/server';
import { readCookie } from '@/lib/server/auth/principal';
import { deleteSessionByToken, SESSION_COOKIE_NAME } from '@/lib/server/auth/session';
import { route } from '@/lib/server/http/responses';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

/** Destroys the current session and clears the cookie. */
export const POST = route(async (req: Request) => {
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE_NAME);
  if (token) {
    await deleteSessionByToken(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return response;
});
