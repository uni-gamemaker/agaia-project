import { requirePrincipal } from '@/lib/server/auth/principal';
import { readJsonBody } from '@/lib/server/http/body';
import { jsonResponse, noContentResponse, route } from '@/lib/server/http/responses';
import { changeMemberRole, removeMember } from '@/lib/server/documents/service';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

type MemberContext = { params: Promise<{ id: string; userId: string }> };

/** Changes a member's role. Owner only. */
export const PATCH = route(async (req: Request, { params }: MemberContext) => {
  const principal = await requirePrincipal(req);
  const { id, userId } = await params;
  const body = await readJsonBody(req);
  const member = await changeMemberRole(principal, id, userId, { role: body.role });
  return jsonResponse(member);
});

/** Removes a member. Owner only. The owner can never be removed. */
export const DELETE = route(async (req: Request, { params }: MemberContext) => {
  const principal = await requirePrincipal(req);
  const { id, userId } = await params;
  await removeMember(principal, id, userId);
  return noContentResponse();
});
