import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { Document, EffectiveRole } from '@/lib/db/schema';
import { documentNotFound, forbidden } from '@/lib/server/http/errors';
import type { Principal } from '@/lib/server/auth/principal';

/**
 * Authorization helper — **CLAUDE-OWNED SEAM**.
 *
 * DeepSeek wrote this as a reference implementation because Claude's lane was not
 * available when this lane started. Every DeepSeek route calls into this module and
 * nowhere else, so Claude can replace it without touching DeepSeek's routes.
 * See lib/server/authz/README.md.
 *
 * INVARIANT (contract §1.2): every read and every mutation is authorized server-side.
 * The UI never decides access.
 */

export type DocumentAccess = {
  document: Document;
  role: EffectiveRole;
  isOwner: boolean;
};

/** What the caller intends to do. Drives the role check. */
export type AccessRequirement = 'read' | 'write' | 'manage';

/**
 * Resolves the caller's access to a document.
 *
 * Returns `null` when the document does not exist **or** when the caller is not the
 * owner and not a member. The two cases are deliberately indistinguishable to the
 * caller so that document existence is not leaked.
 */
export async function getDocumentAccess(
  documentId: string,
  principal: Principal,
): Promise<DocumentAccess | null> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);

  const document = rows[0];
  if (!document) return null;

  if (document.ownerId === principal.userId) {
    return { document, role: 'owner', isOwner: true };
  }

  const memberships = await db
    .select({ role: schema.documentMembers.role })
    .from(schema.documentMembers)
    .where(
      and(
        eq(schema.documentMembers.documentId, documentId),
        eq(schema.documentMembers.userId, principal.userId),
      ),
    )
    .limit(1);

  const membership = memberships[0];
  if (!membership) return null;

  return { document, role: membership.role, isOwner: false };
}

/**
 * Same as {@link getDocumentAccess} but throws the mapped HTTP error:
 * - not a member / missing document → `404 DOCUMENT_NOT_FOUND`
 * - member, but the role forbids the action → `403 FORBIDDEN`
 */
export async function requireDocumentAccess(
  documentId: string,
  principal: Principal,
  requirement: AccessRequirement = 'read',
): Promise<DocumentAccess> {
  const access = await getDocumentAccess(documentId, principal);

  if (!access) {
    throw documentNotFound();
  }

  if (requirement === 'write' && access.role === 'viewer') {
    throw forbidden('Viewers can read this document but cannot edit it.');
  }

  if (requirement === 'manage' && !access.isOwner) {
    throw forbidden('Only the owner of this document can manage sharing.');
  }

  return access;
}
