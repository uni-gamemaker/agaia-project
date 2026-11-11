import { requirePrincipal } from '@/lib/server/auth/principal';
import { readJsonBody } from '@/lib/server/http/body';
import { jsonResponse, route } from '@/lib/server/http/responses';
import { listMembers, shareDocument } from '@/lib/server/documents/service';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

type MembersContext = { params: Promise<{ id: string }> };

/** Lists the owner and the members of a document. */
export const GET = route(async (req: Request, { params }: MembersContext) => {
  const principal = await requirePrincipal(req);
  const { id } = await params;
  const result = await listMembers(principal, id);
  return jsonResponse(result);
});

/** Shares a document with another user. Owner only. */
export const POST = route(async (req: Request, { params }: MembersContext) => {
  const principal = await requirePrincipal(req);
  const { id } = await params;
  const body = await readJsonBody(req);
  const member = await shareDocument(principal, id, {
    email: body.email,
    role: body.role,
  });
  return jsonResponse(member, 201);
});
