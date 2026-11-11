import { NextResponse } from 'next/server';
import { createSession, isDemoMode, SESSION_COOKIE_NAME } from '@/lib/server/auth/session';
import { findUserByEmail } from '@/lib/server/documents/repository';
import { readJsonBody } from '@/lib/server/http/body';
import { forbidden, userNotFound, validationError } from '@/lib/server/http/errors';
import { route } from '@/lib/server/http/responses';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

/**
 * Demo-only account switcher.
 *
 * This is **not** production authentication. It is gated behind `DEMO_MODE=true` and
 * exists so reviewers can exercise both roles without passwords. The identity still
 * lives entirely on the server — the browser only receives an httpOnly session cookie.
 */
export const POST = route(async (req: Request) => {
  if (!isDemoMode()) {
    throw forbidden('The demo account switcher is disabled on this deployment.');
  }

  const body = await readJsonBody(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email) {
    throw validationError('An email address is required.', { field: 'email' });
  }

  const user = await findUserByEmail(email);
  if (!user) {
    throw userNotFound(`No demo user exists with the email address "${email}".`);
  }

  const { token, expiresAt } = await createSession(user.id);

  const response = NextResponse.json({
    user: { userId: user.id, email: user.email, displayName: user.displayName },
    demo: true,
  });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return response;
});
