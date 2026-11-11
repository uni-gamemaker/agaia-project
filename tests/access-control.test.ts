import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/lib/db/client';
import {
  apiRequest,
  createUser,
  jsonRequest,
  patchRequest,
  readJson,
  resetDatabase,
  sessionCookieFor,
} from './helpers';
import { GET as getDocument, PATCH as patchDocument, DELETE as deleteDocument } from '@/app/api/documents/[id]/route';
import { POST as createDocumentRoute } from '@/app/api/documents/route';
import { POST as shareRoute } from '@/app/api/documents/[id]/members/route';
import { DELETE as removeMemberRoute, PATCH as changeRoleRoute } from '@/app/api/documents/[id]/members/[userId]/route';

describe('server-side access control', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('rejects an unauthenticated read with 401', async () => {
    const ownerId = await createUser('anon-owner@example.com', 'Anon Owner');
    const ownerCookie = await sessionCookieFor(ownerId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie: ownerCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Private' }),
        }),
      ),
    );

    const response = await getDocument(
      apiRequest(`/api/documents/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(401);
    const error = await readJson<any>(response);
    expect(error.error.code).toBe('UNAUTHENTICATED');
  });

  it('hides a document from a user who was never granted access (404, no content leak)', async () => {
    const ownerId = await createUser('secret-owner@example.com', 'Secret Owner');
    const strangerId = await createUser('stranger@example.com', 'Stranger');
    const ownerCookie = await sessionCookieFor(ownerId);
    const strangerCookie = await sessionCookieFor(strangerId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie: ownerCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Top secret', content: { type: 'doc', content: [] } }),
        }),
      ),
    );

    const response = await getDocument(
      apiRequest(`/api/documents/${created.id}`, { cookie: strangerCookie }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain('Top secret');
    expect(body).not.toContain('content');
    const error = JSON.parse(body);
    expect(error.error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('lets a viewer read but not write, and lets an editor write', async () => {
    const ownerId = await createUser('role-owner@example.com', 'Role Owner');
    const viewerId = await createUser('viewer@example.com', 'Viewer');
    const editorId = await createUser('editor@example.com', 'Editor');
    const ownerCookie = await sessionCookieFor(ownerId);
    const viewerCookie = await sessionCookieFor(viewerId);
    const editorCookie = await sessionCookieFor(editorId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie: ownerCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Shared doc' }),
        }),
      ),
    );

    const shareViewer = await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'viewer@example.com', role: 'viewer' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(shareViewer.status).toBe(201);

    const shareEditor = await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'editor@example.com', role: 'editor' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(shareEditor.status).toBe(201);

    // Viewer may read.
    const viewerRead = await getDocument(
      apiRequest(`/api/documents/${created.id}`, { cookie: viewerCookie }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(viewerRead.status).toBe(200);
    expect((await readJson<any>(viewerRead)).role).toBe('viewer');

    // Viewer may not write.
    const viewerWrite = await patchDocument(
      patchRequest(
        `/api/documents/${created.id}`,
        { title: 'Viewer rename attempt' },
        { cookie: viewerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(viewerWrite.status).toBe(403);
    expect((await readJson<any>(viewerWrite)).error.code).toBe('FORBIDDEN');

    // Editor may write.
    const editorWrite = await patchDocument(
      patchRequest(
        `/api/documents/${created.id}`,
        { title: 'Editor rename' },
        { cookie: editorCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(editorWrite.status).toBe(200);
    expect((await readJson<any>(editorWrite)).title).toBe('Editor rename');

    // The viewer's write attempt must not have changed anything.
    const afterViewerAttempt = await readJson<any>(
      await getDocument(apiRequest(`/api/documents/${created.id}`, { cookie: ownerCookie }), {
        params: Promise.resolve({ id: created.id }),
      }),
    );
    expect(afterViewerAttempt.title).toBe('Editor rename');
  });

  it('stops an editor from resharing the document', async () => {
    const ownerId = await createUser('reshare-owner@example.com', 'Reshare Owner');
    const editorId = await createUser('reshare-editor@example.com', 'Reshare Editor');
    const ownerCookie = await sessionCookieFor(ownerId);
    const editorCookie = await sessionCookieFor(editorId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie: ownerCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Reshare' }),
        }),
      ),
    );

    await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'reshare-editor@example.com', role: 'editor' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );

    const response = await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'reshare-owner@example.com', role: 'viewer' },
        { cookie: editorCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(403);
    expect((await readJson<any>(response)).error.code).toBe('FORBIDDEN');
  });

  it('rejects self-sharing and unknown users with clear errors', async () => {
    const ownerId = await createUser('self@example.com', 'Self Owner');
    const ownerCookie = await sessionCookieFor(ownerId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie: ownerCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Self share' }),
        }),
      ),
    );

    const selfShare = await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'self@example.com', role: 'viewer' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(selfShare.status).toBe(400);
    expect((await readJson<any>(selfShare)).error.code).toBe('SHARING_SELF_NOT_ALLOWED');

    const unknownUser = await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'nobody@example.com', role: 'viewer' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(unknownUser.status).toBe(404);
    expect((await readJson<any>(unknownUser)).error.code).toBe('USER_NOT_FOUND');

    const badRole = await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'self@example.com', role: 'admin' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(badRole.status).toBe(422);
    expect((await readJson<any>(badRole)).error.code).toBe('VALIDATION_ERROR');
  });

  it('never lets the owner be removed, and removes a member on request', async () => {
    const ownerId = await createUser('members-owner@example.com', 'Members Owner');
    const memberId = await createUser('members-member@example.com', 'Members Member');
    const ownerCookie = await sessionCookieFor(ownerId);
    const memberCookie = await sessionCookieFor(memberId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie: ownerCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Membership' }),
        }),
      ),
    );

    await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'members-member@example.com', role: 'editor' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );

    // The owner is not a member row and can never be removed.
    const removeOwner = await removeMemberRoute(
      apiRequest(`/api/documents/${created.id}/members/${ownerId}`, {
        method: 'DELETE',
        cookie: ownerCookie,
      }),
      { params: Promise.resolve({ id: created.id, userId: ownerId }) },
    );
    expect(removeOwner.status).toBe(404);
    expect((await readJson<any>(removeOwner)).error.code).toBe('MEMBER_NOT_FOUND');

    // The owner can still read their document.
    expect(
      (
        await getDocument(apiRequest(`/api/documents/${created.id}`, { cookie: ownerCookie }), {
          params: Promise.resolve({ id: created.id }),
        })
      ).status,
    ).toBe(200);

    // A member's role can be changed.
    const roleChange = await changeRoleRoute(
      patchRequest(
        `/api/documents/${created.id}/members/${memberId}`,
        { role: 'viewer' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id, userId: memberId }) },
    );
    expect(roleChange.status).toBe(200);
    expect((await readJson<any>(roleChange)).role).toBe('viewer');

    // And the member can be removed, which revokes their access.
    const removeMember = await removeMemberRoute(
      apiRequest(`/api/documents/${created.id}/members/${memberId}`, {
        method: 'DELETE',
        cookie: ownerCookie,
      }),
      { params: Promise.resolve({ id: created.id, userId: memberId }) },
    );
    expect(removeMember.status).toBe(204);

    const afterRemoval = await getDocument(
      apiRequest(`/api/documents/${created.id}`, { cookie: memberCookie }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(afterRemoval.status).toBe(404);
  });

  it('only lets the owner delete a document', async () => {
    const ownerId = await createUser('delete-owner@example.com', 'Delete Owner');
    const editorId = await createUser('delete-editor@example.com', 'Delete Editor');
    const ownerCookie = await sessionCookieFor(ownerId);
    const editorCookie = await sessionCookieFor(editorId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie: ownerCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Deletable' }),
        }),
      ),
    );

    await shareRoute(
      jsonRequest(
        `/api/documents/${created.id}/members`,
        { email: 'delete-editor@example.com', role: 'editor' },
        { cookie: ownerCookie },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );

    const editorDelete = await deleteDocument(
      apiRequest(`/api/documents/${created.id}`, { method: 'DELETE', cookie: editorCookie }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(editorDelete.status).toBe(403);

    const ownerDelete = await deleteDocument(
      apiRequest(`/api/documents/${created.id}`, { method: 'DELETE', cookie: ownerCookie }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(ownerDelete.status).toBe(204);

    const afterDelete = await getDocument(
      apiRequest(`/api/documents/${created.id}`, { cookie: ownerCookie }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(afterDelete.status).toBe(404);
  });
});
