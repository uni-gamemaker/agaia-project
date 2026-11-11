import { requirePrincipal } from '@/lib/server/auth/principal';
import { readJsonBody } from '@/lib/server/http/body';
import { jsonResponse, noContentResponse, route } from '@/lib/server/http/responses';
import {
  deleteDocument,
  readDocument,
  updateDocument,
} from '@/lib/server/documents/service';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

type DocumentContext = { params: Promise<{ id: string }> };

/** Reads a document the caller owns or is a member of. */
export const GET = route(async (req: Request, { params }: DocumentContext) => {
  const principal = await requirePrincipal(req);
  const { id } = await params;
  const document = await readDocument(principal, id);
  return jsonResponse(document);
});

/**
 * Updates a document. This is the autosave target: send `{ title?, content? }`.
 * A viewer receives 403; a non-member receives 404.
 */
export const PATCH = route(async (req: Request, { params }: DocumentContext) => {
  const principal = await requirePrincipal(req);
  const { id } = await params;
  const body = await readJsonBody(req);
  const document = await updateDocument(principal, id, {
    title: body.title,
    content: body.content,
    expectedUpdatedAt: body.expectedUpdatedAt,
  });
  return jsonResponse(document);
});

/** Deletes a document. Owner only. */
export const DELETE = route(async (req: Request, { params }: DocumentContext) => {
  const principal = await requirePrincipal(req);
  const { id } = await params;
  await deleteDocument(principal, id);
  return noContentResponse();
});

