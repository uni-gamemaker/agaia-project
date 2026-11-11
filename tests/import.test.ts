import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/lib/db/client';
import { apiRequest, createUser, readJson, resetDatabase, sessionCookieFor } from './helpers';
import { POST as importRoute } from '@/app/api/documents/import/route';

const MAX_UPLOAD_BYTES = 1_048_576;

function uploadRequest(cookie: string, file: File, title?: string): Request {
  const form = new FormData();
  form.append('file', file);
  if (title) form.append('title', title);
  return apiRequest('/api/documents/import', { method: 'POST', cookie, body: form });
}

describe('file import', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('imports a Markdown file into a structured document', async () => {
    const userId = await createUser('import-md@example.com', 'Import MD');
    const cookie = await sessionCookieFor(userId);

    const markdown = [
      '# Release notes',
      '',
      'This paragraph has **bold** and *italic* text.',
      '',
      '- first bullet',
      '- second bullet',
      '',
      '1. step one',
      '2. step two',
    ].join('\n');

    const response = await importRoute(
      uploadRequest(cookie, new File([markdown], 'release-notes.md', { type: 'text/markdown' })),
    );

    expect(response.status).toBe(201);
    const document = await readJson<any>(response);
    expect(document.title).toBe('release notes');
    expect(document.ownership).toBe('owned');
    expect(document.content.type).toBe('doc');

    const blocks = document.content.content;
    expect(blocks[0].type).toBe('heading');
    expect(blocks[0].attrs.level).toBe(1);
    expect(blocks[1].type).toBe('paragraph');

    const marks = blocks[1].content.map((node: any) => node.marks?.[0]?.type).filter(Boolean);
    expect(marks).toContain('bold');
    expect(marks).toContain('italic');

    expect(blocks[2].type).toBe('bulletList');
    expect(blocks[3].type).toBe('orderedList');
    expect(blocks[3].content).toHaveLength(2);
  });

  it('imports a plain text file into paragraphs with preserved line breaks', async () => {
    const userId = await createUser('import-txt@example.com', 'Import TXT');
    const cookie = await sessionCookieFor(userId);

    const text = 'First line\nsecond line\n\nA second paragraph.';

    const response = await importRoute(
      uploadRequest(cookie, new File([text], 'plain notes.txt', { type: 'text/plain' })),
    );

    expect(response.status).toBe(201);
    const document = await readJson<any>(response);
    expect(document.title).toBe('plain notes');

    const blocks = document.content.content;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].content.some((node: any) => node.type === 'hardBreak')).toBe(true);
    expect(blocks[1].content[0].text).toBe('A second paragraph.');
  });

  it('rejects an unsupported file type with 415', async () => {
    const userId = await createUser('import-bad@example.com', 'Import Bad');
    const cookie = await sessionCookieFor(userId);

    const response = await importRoute(
      uploadRequest(cookie, new File(['binary-ish'], 'payload.exe', { type: 'text/plain' })),
    );

    expect(response.status).toBe(415);
    const error = await readJson<any>(response);
    expect(error.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a disallowed content type with 415', async () => {
    const userId = await createUser('import-mime@example.com', 'Import Mime');
    const cookie = await sessionCookieFor(userId);

    const response = await importRoute(
      uploadRequest(
        cookie,
        new File(['data'], 'notes.txt', { type: 'application/x-msdownload' }),
      ),
    );

    expect(response.status).toBe(415);
    expect((await readJson<any>(response)).error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects an oversized upload with 413', async () => {
    const userId = await createUser('import-big@example.com', 'Import Big');
    const cookie = await sessionCookieFor(userId);

    const oversized = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.txt', {
      type: 'text/plain',
    });

    const response = await importRoute(uploadRequest(cookie, oversized));

    expect(response.status).toBe(413);
    const error = await readJson<any>(response);
    expect(error.error.code).toBe('FILE_TOO_LARGE');
    expect(error.error.details.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  it('rejects a binary file disguised with a .txt extension', async () => {
    const userId = await createUser('import-binary@example.com', 'Import Binary');
    const cookie = await sessionCookieFor(userId);

    const response = await importRoute(
      uploadRequest(cookie, new File([new Uint8Array([0, 1, 2, 3])], 'sneaky.txt', {
        type: 'text/plain',
      })),
    );

    expect(response.status).toBe(415);
    expect((await readJson<any>(response)).error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('never stores uploaded content as raw HTML', async () => {
    const userId = await createUser('import-html@example.com', 'Import HTML');
    const cookie = await sessionCookieFor(userId);

    const markdown = [
      'Before',
      '',
      '<script>alert("xss")</script>',
      '',
      '<img src=x onerror="alert(1)">',
      '',
      'After',
    ].join('\n');

    const response = await importRoute(
      uploadRequest(cookie, new File([markdown], 'hostile.md', { type: 'text/markdown' })),
    );

    expect(response.status).toBe(201);
    const document = await readJson<any>(response);
    const serialized = JSON.stringify(document.content);

    expect(serialized).not.toContain('script');
    expect(serialized).not.toContain('onerror');
    // No node in the stored document may be an html node.
    const nodeTypes: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.type === 'string') nodeTypes.push(node.type);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(document.content);
    expect(nodeTypes).not.toContain('html');
  });

  it('requires a file', async () => {
    const userId = await createUser('import-empty@example.com', 'Import Empty');
    const cookie = await sessionCookieFor(userId);

    const form = new FormData();
    const response = await importRoute(
      apiRequest('/api/documents/import', { method: 'POST', cookie, body: form }),
    );

    expect(response.status).toBe(422);
    expect((await readJson<any>(response)).error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const response = await importRoute(
      uploadRequest('', new File(['hello'], 'hello.txt', { type: 'text/plain' })),
    );
    expect(response.status).toBe(401);
  });
});
