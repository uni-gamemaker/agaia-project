import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { truncateAll } from '@/lib/db/seed';
import { createSession, SESSION_COOKIE_NAME } from '@/lib/server/auth/session';

/**
 * Test helpers.
 *
 * The suites use an isolated local libSQL database so persistence and server-side
 * authorization are exercised without touching a developer's or production database.
 */

export async function resetDatabase(): Promise<void> {
  await truncateAll();
}

export async function createUser(email: string, displayName: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.users)
    .values({ email: email.toLowerCase(), displayName })
    .returning({ id: schema.users.id });
  return row.id;
}

/** Creates a server-side session and returns the `Cookie` header value for it. */
export async function sessionCookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

type ApiOptions = RequestInit & { cookie?: string };

/** Builds a plain `Request` for a route handler. */
export function apiRequest(path: string, options: ApiOptions = {}): Request {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set('cookie', options.cookie);
  return new Request(`http://localhost${path}`, { ...options, headers });
}

export function jsonRequest(path: string, body: unknown, options: ApiOptions = {}): Request {
  return apiRequest(path, {
    method: 'POST',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

export function patchRequest(path: string, body: unknown, options: ApiOptions = {}): Request {
  return apiRequest(path, {
    method: 'PATCH',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

/** Reads a JSON response body with a helpful failure message. */
export async function readJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON but received (status ${response.status}): ${text}`);
  }
}

/** A TipTap document exercising every formatting feature the assignment requires. */
export function richTipTapDoc() {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'underline', marks: [{ type: 'underline' }] },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
          },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
          },
        ],
      },
    ],
  };
}
