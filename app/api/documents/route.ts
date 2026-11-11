import { requirePrincipal } from '@/lib/server/auth/principal';
import { readJsonBody } from '@/lib/server/http/body';
import { jsonResponse, route } from '@/lib/server/http/responses';
import { createDocument, listDocuments } from '@/lib/server/documents/service';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

/** Lists every document the caller can see — owned and shared. */
export const GET = route(async (req: Request) => {
  const principal = await requirePrincipal(req);
  const documents = await listDocuments(principal);
  return jsonResponse({ documents });
});

/** Creates a document owned by the caller. */
export const POST = route(async (req: Request) => {
  const principal = await requirePrincipal(req);
  const body = await readJsonBody(req);
  const document = await createDocument(principal, {
    title: body.title,
    content: body.content,
  });
  return jsonResponse(document, 201);
});
