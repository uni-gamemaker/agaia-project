import { unauthenticated } from '@/lib/server/http/errors';
import { findUserBySessionToken, SESSION_COOKIE_NAME } from './session';

/**
 * Identity resolution — **CLAUDE-OWNED SEAM**.
 *
 * DeepSeek wrote this as a reference implementation because Claude's lane was not
 * available when this lane started. See lib/server/auth/README.md.
 *
 * INVARIANT (contract §1.1): the acting user is resolved from the server-side session
 * cookie only. A user ID supplied by the client is never treated as proof of identity.
 */

export type Principal = {
  userId: string;
  email: string;
  displayName: string;
};

/** Reads a single cookie from a raw `Cookie` header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * Resolves the acting user for a request, or null when there is no valid session.
 */
export async function resolvePrincipal(req: Request): Promise<Principal | null> {
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE_NAME);
  if (!token) return null;
  return findUserBySessionToken(token);
}

/**
 * Resolves the acting user or throws 401 UNAUTHENTICATED.
 */
export async function requirePrincipal(req: Request): Promise<Principal> {
  const principal = await resolvePrincipal(req);
  if (!principal) throw unauthenticated();
  return principal;
}
