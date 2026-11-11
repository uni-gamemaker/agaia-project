/**
 * End-to-end smoke test against a running server.
 *
 * Usage:
 *   npm run build && npm start        # in one terminal
 *   npm run smoke                     # in another
 *
 * This exercises the same paths a reviewer would: demo login, create, read,
 * import, share, and role enforcement for both seeded users.
 */

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`, detail ?? '');
  }
}

interface Session {
  cookie: string;
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; session?: Session; form?: FormData } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.session) headers.cookie = options.session.cookie;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function login(email: string): Promise<Session> {
  const response = await fetch(`${BASE_URL}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const raw = response.headers.get('set-cookie') ?? '';
  const token = raw.split(';')[0];
  if (response.status !== 200 || !token) {
    throw new Error(`demo-login failed for ${email}: ${response.status} ${raw}`);
  }
  return { cookie: token };
}

async function main(): Promise<void> {
  console.log(`Smoke test against ${BASE_URL}\n`);

  console.log('health');
  const health = await request('/api/health');
  check('GET /api/health returns 200', health.status === 200, health.body);
  check('database is reachable', health.body?.database === 'up', health.body);

  console.log('\nidentity');
  const unauth = await request('/api/documents');
  check('unauthenticated list is rejected with 401', unauth.status === 401, unauth.body);

  const alex = await login('alex@demo.local');
  check('demo login issues a session cookie', alex.cookie.startsWith('ajaia_session='), alex.cookie);

  const me = await request('/api/me', { session: alex });
  check('GET /api/me resolves the user', me.body?.user?.email === 'alex@demo.local', me.body);

  console.log('\ndocument lifecycle');
  const created = await request('/api/documents', {
    method: 'POST',
    session: alex,
    body: { title: 'Smoke test document' },
  });
  check('create returns 201', created.status === 201, created.body);
  check('new document is owned', created.body?.ownership === 'owned', created.body);
  const documentId = created.body?.id as string;

  const read = await request(`/api/documents/${documentId}`, { session: alex });
  check('read returns the same title', read.body?.title === 'Smoke test document', read.body);

  const renamed = await request(`/api/documents/${documentId}`, {
    method: 'PATCH',
    session: alex,
    body: { title: 'Smoke test document (renamed)' },
  });
  check('rename returns 200', renamed.status === 200, renamed.body);
  check('rename persisted', renamed.body?.title === 'Smoke test document (renamed)', renamed.body);

  console.log('\nimport');
  const markdown = ['# Imported', '', 'With **bold** text.', '', '- one', '- two'].join('\n');
  const form = new FormData();
  form.append('file', new File([markdown], 'smoke.md', { type: 'text/markdown' }));
  const imported = await request('/api/documents/import', { method: 'POST', session: alex, form });
  check('import returns 201', imported.status === 201, imported.body);
  check('import produced a heading', imported.body?.content?.content?.[0]?.type === 'heading', imported.body);
  check(
    'import produced a bullet list',
    imported.body?.content?.content?.some((n: any) => n.type === 'bulletList'),
    imported.body,
  );

  const badForm = new FormData();
  badForm.append('file', new File(['x'], 'payload.exe', { type: 'text/plain' }));
  const badImport = await request('/api/documents/import', {
    method: 'POST',
    session: alex,
    form: badForm,
  });
  check('unsupported file type is rejected with 415', badImport.status === 415, badImport.body);

  console.log('\nsharing and roles');
  const share = await request(`/api/documents/${documentId}/members`, {
    method: 'POST',
    session: alex,
    body: { email: 'sam@demo.local', role: 'viewer' },
  });
  check('owner can share with a viewer', share.status === 201, share.body);

  const selfShare = await request(`/api/documents/${documentId}/members`, {
    method: 'POST',
    session: alex,
    body: { email: 'alex@demo.local', role: 'viewer' },
  });
  check('self-sharing is rejected with 400', selfShare.status === 400, selfShare.body);

  const unknownShare = await request(`/api/documents/${documentId}/members`, {
    method: 'POST',
    session: alex,
    body: { email: 'nobody@example.com', role: 'viewer' },
  });
  check('sharing with an unknown user is rejected with 404', unknownShare.status === 404, unknownShare.body);

  const sam = await login('sam@demo.local');
  const samRead = await request(`/api/documents/${documentId}`, { session: sam });
  check('viewer can read the shared document', samRead.status === 200, samRead.body);
  check('viewer sees the viewer role', samRead.body?.role === 'viewer', samRead.body);

  const samWrite = await request(`/api/documents/${documentId}`, {
    method: 'PATCH',
    session: sam,
    body: { title: 'Viewer should not be able to rename this' },
  });
  check('viewer cannot write', samWrite.status === 403, samWrite.body);

  const samList = await request('/api/documents', { session: sam });
  const shared = samList.body?.documents?.find((d: any) => d.id === documentId);
  check('shared document is listed for the viewer', shared?.ownership === 'shared', samList.body);

  console.log('\naccess revocation');
  const memberUserId = share.body?.userId as string;
  const promote = await request(`/api/documents/${documentId}/members/${memberUserId}`, {
    method: 'PATCH',
    session: alex,
    body: { role: 'editor' },
  });
  check('owner can change a member role', promote.status === 200, promote.body);

  const promotedWrite = await request(`/api/documents/${documentId}`, {
    method: 'PATCH',
    session: sam,
    body: { title: 'Now an editor' },
  });
  check('promoted editor can write', promotedWrite.status === 200, promotedWrite.body);

  const remove = await request(`/api/documents/${documentId}/members/${memberUserId}`, {
    method: 'DELETE',
    session: alex,
  });
  check('owner can remove a member', remove.status === 204, remove.body);

  const afterRemoval = await request(`/api/documents/${documentId}`, { session: sam });
  check('removed member loses access', afterRemoval.status === 404, afterRemoval.body);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
