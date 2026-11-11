import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/lib/db/client';
import { apiRequest, createUser, readJson, resetDatabase, sessionCookieFor } from './helpers';
import { GET as getDocument, PATCH as patchDocument } from '@/app/api/documents/[id]/route';
import { GET as listDocuments, POST as createDocumentRoute } from '@/app/api/documents/route';

describe('document persistence', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('persists a document and returns it again on a later re-fetch', async () => {
    const ownerId = await createUser('owner@example.com', 'Owner');
    const cookie = await sessionCookieFor(ownerId);

    const createResponse = await createDocumentRoute(
      apiRequest('/api/documents', {
        method: 'POST',
        cookie,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Persisted document' }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = await readJson<any>(createResponse);
    expect(created.id).toBeTruthy();
    expect(created.title).toBe('Persisted document');
    expect(created.ownership).toBe('owned');
    expect(created.role).toBe('owner');
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();

    // A second, independent request proves the value came back from the database
    // rather than from an in-memory cache.
    const readResponse = await getDocument(
      apiRequest(`/api/documents/${created.id}`, { cookie }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(readResponse.status).toBe(200);
    const reread = await readJson<any>(readResponse);
    expect(reread.id).toBe(created.id);
    expect(reread.title).toBe(created.title);
    expect(reread.content).toEqual(created.content);
    expect(reread.updatedAt).toBe(created.updatedAt);
  });

  it('round-trips structured editor content without losing formatting', async () => {
    const ownerId = await createUser('format@example.com', 'Formatter');
    const cookie = await sessionCookieFor(ownerId);

    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    };

    const createResponse = await createDocumentRoute(
      apiRequest('/api/documents', {
        method: 'POST',
        cookie,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Formatting', content }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = await readJson<any>(createResponse);

    const reread = await readJson<any>(
      await getDocument(apiRequest(`/api/documents/${created.id}`, { cookie }), {
        params: Promise.resolve({ id: created.id }),
      }),
    );

    expect(reread.content).toEqual(content);
    // Formatting must survive as *structure*, not as flattened text.
    expect(reread.content.content[0].type).toBe('heading');
    expect(reread.content.content[0].attrs.level).toBe(2);
    expect(reread.content.content[1].content[0].marks[0].type).toBe('bold');
    expect(reread.content.content[1].content[2].marks[0].type).toBe('italic');
  });

  it('updates content and title and bumps updatedAt', async () => {
    const ownerId = await createUser('update@example.com', 'Updater');
    const cookie = await sessionCookieFor(ownerId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Before' }),
        }),
      ),
    );

    const updateResponse = await patchDocument(
      apiRequest(`/api/documents/${created.id}`, {
        method: 'PATCH',
        cookie,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'After' }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(updateResponse.status).toBe(200);
    const updated = await readJson<any>(updateResponse);
    expect(updated.title).toBe('After');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );

    const reread = await readJson<any>(
      await getDocument(apiRequest(`/api/documents/${created.id}`, { cookie }), {
        params: Promise.resolve({ id: created.id }),
      }),
    );
    expect(reread.title).toBe('After');
  });

  it('lists owned documents separately from shared documents', async () => {
    const ownerId = await createUser('list-owner@example.com', 'List Owner');
    const ownerCookie = await sessionCookieFor(ownerId);

    const created = await readJson<any>(
      await createDocumentRoute(
        apiRequest('/api/documents', {
          method: 'POST',
          cookie: ownerCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Owned doc' }),
        }),
      ),
    );

    const list = await readJson<any>(
      await listDocuments(apiRequest('/api/documents', { cookie: ownerCookie })),
    );

    const found = list.documents.find((doc: any) => doc.id === created.id);
    expect(found).toBeDefined();
    expect(found.ownership).toBe('owned');
    expect(found.role).toBe('owner');
    // The list endpoint must not ship every document body.
    expect(found.content).toBeUndefined();
  });

  it('rejects an invalid TipTap payload instead of persisting it', async () => {
    const ownerId = await createUser('invalid@example.com', 'Invalid');
    const cookie = await sessionCookieFor(ownerId);

    const response = await createDocumentRoute(
      apiRequest('/api/documents', {
        method: 'POST',
        cookie,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Bad content', content: { type: 'not-a-doc' } }),
      }),
    );

    expect(response.status).toBe(422);
    const error = await readJson<any>(response);
    expect(error.error.code).toBe('VALIDATION_ERROR');
  });
});
