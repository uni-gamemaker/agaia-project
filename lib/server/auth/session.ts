import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { LIMITS } from '@/lib/tiptap';

/**
 * Session store — **CLAUDE-OWNED SEAM**.
 *
 * DeepSeek wrote this as a reference implementation because Claude's lane was not
 * available when this lane started. The interface is deliberately small so Claude can
 * replace the internals without touching any DeepSeek file. See
 * lib/server/auth/README.md.
 *
 * Design notes:
 * - The raw session token exists only in the httpOnly cookie. The database stores
 *   only its SHA-256 hash, so a database leak cannot be replayed as a session.
 * - Tokens are 32 bytes of CSPRNG output (base64url).
 */

export const SESSION_COOKIE_NAME = 'ajaia_session';

export type SessionUser = {
  userId: string;
  email: string;
  displayName: string;
};

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionTtlDays(): number {
  const raw = process.env.SESSION_TTL_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : LIMITS.MAX_SESSION_TTL_DAYS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : LIMITS.MAX_SESSION_TTL_DAYS;
}

/** Creates a session for a user and returns the raw token exactly once. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + sessionTtlDays() * 24 * 60 * 60 * 1000);
  await getDb()
    .insert(schema.sessions)
    .values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

/** Deletes the session behind a raw token. Safe to call with an unknown token. */
export async function deleteSessionByToken(token: string): Promise<void> {
  await getDb()
    .delete(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashSessionToken(token)));
}

/** Resolves a raw token to its user, or null when the token is unknown or expired. */
export async function findUserBySessionToken(token: string): Promise<SessionUser | null> {
  const rows = await getDb()
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashSessionToken(token)),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** True when the demo account switcher is enabled. Never true unless explicitly set. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}
