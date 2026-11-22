import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as authGet, POST as authPost } from '@/app/api/auth/[...all]/route';
import { GET as meRoute } from '@/app/api/me/route';
import { resetDatabase } from './helpers';

const AUTH_URL = 'http://localhost:3001/api/auth';
const ORIGIN = 'http://localhost:3001';
const EMAIL = 'auth-check@example.test';
const PASSWORD = 'correct horse battery staple';

let emailMessages: string[] = [];

function authRequest(path: string, body: unknown): Request {
  return new Request(`${AUTH_URL}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postAuth(path: string, body: unknown): Promise<Response> {
  return authPost(authRequest(path, body));
}

function linkFromEmail(subject: string): URL {
  const message = emailMessages.find((item) => item.includes(subject));
  const link = message?.match(/https?:\/\/[^\s]+/)?.[0];
  if (!link) throw new Error(`No local ${subject} link was logged.`);
  return new URL(link);
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('Expected Better Auth to issue a session cookie.');
  return setCookie.split(';', 1)[0];
}

async function createVerifiedAccount(): Promise<void> {
  const signUp = await postAuth('/sign-up/email', { name: 'Auth Check', email: EMAIL, password: PASSWORD });
  expect(signUp.status).toBe(200);
  const verificationLink = linkFromEmail('Verify your Ajaia email');
  const verified = await authGet(new Request(verificationLink, { headers: { origin: ORIGIN }, redirect: 'manual' }));
  expect([200, 302, 303]).toContain(verified.status);
}

describe('Better Auth account flows', () => {
  beforeEach(async () => {
    emailMessages = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      emailMessages.push(args.map(String).join(' '));
    });
    await resetDatabase();
  });

  afterEach(() => vi.restoreAllMocks());

  it('accepts localhost port 3001, blocks unverified sign-in, and authenticates after email verification', async () => {
    const signUp = await postAuth('/sign-up/email', { name: 'Auth Check', email: EMAIL, password: PASSWORD });
    expect(signUp.status).toBe(200);
    expect(emailMessages.join('\n')).toContain(EMAIL);

    const unverifiedSignIn = await postAuth('/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(unverifiedSignIn.status).toBe(403);

    const verificationLink = linkFromEmail('Verify your Ajaia email');
    expect(verificationLink.origin).toBe(ORIGIN);
    const verified = await authGet(new Request(verificationLink, { headers: { origin: ORIGIN }, redirect: 'manual' }));
    expect([200, 302, 303]).toContain(verified.status);

    const signIn = await postAuth('/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(signIn.status).toBe(200);
    const setCookie = signIn.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);

    const me = await meRoute(new Request('http://localhost:3001/api/me', {
      headers: { cookie: sessionCookie(signIn) },
    }));
    expect(me.status).toBe(200);
    expect((await me.json()).user.email).toBe(EMAIL);
  });

  it('sends a reset link, changes the password, and revokes existing sessions', async () => {
    await createVerifiedAccount();
    const oldSignIn = await postAuth('/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(oldSignIn.status).toBe(200);
    const oldCookie = sessionCookie(oldSignIn);

    emailMessages = [];
    const resetRequest = await postAuth('/request-password-reset', {
      email: EMAIL,
      redirectTo: `${ORIGIN}/reset-password`,
    });
    expect(resetRequest.status).toBe(200);

    const resetLink = linkFromEmail('Reset your Ajaia password');
    const token = resetLink.pathname.split('/').at(-1);
    expect(token).toBeTruthy();
    const reset = await postAuth('/reset-password', { newPassword: 'new secure password 2', token });
    expect(reset.status).toBe(200);

    const oldSession = await meRoute(new Request('http://localhost:3001/api/me', { headers: { cookie: oldCookie } }));
    expect(oldSession.status).toBe(401);

    const oldPassword = await postAuth('/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(oldPassword.status).toBe(401);
    const newPassword = await postAuth('/sign-in/email', { email: EMAIL, password: 'new secure password 2' });
    expect(newPassword.status).toBe(200);
  });
});
