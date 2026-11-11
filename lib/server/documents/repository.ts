import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { Document, DocumentMember, DocumentRole, User } from '@/lib/db/schema';
import type { TipTapDoc } from '@/lib/tiptap';

/**
 * Data access for documents, memberships and users — DeepSeek-owned.
 *
 * This module performs **no authorization**. Every read and write that touches a
 * document must be preceded by an access check from `lib/server/authz`. That
 * separation is deliberate: it keeps the role rules in exactly one place.
 */

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const rows = await getDb().select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findDocumentById(id: string): Promise<Document | null> {
  const rows = await getDb().select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertDocument(input: {
  title: string;
  content: TipTapDoc;
  ownerId: string;
}): Promise<Document> {
  const [row] = await getDb()
    .insert(schema.documents)
    .values({
      title: input.title,
      content: input.content,
      ownerId: input.ownerId,
    })
    .returning();
  return row;
}

/**
 * Updates a document and bumps `updated_at`.
 * Returns the updated row, or null when the document no longer exists.
 */
export async function updateDocumentRow(
  id: string,
  patch: { title?: string; content?: TipTapDoc },
  expectedUpdatedAt?: Date,
): Promise<Document | null> {
  const conditions = [eq(schema.documents.id, id)];
  if (expectedUpdatedAt) conditions.push(eq(schema.documents.updatedAt, expectedUpdatedAt));
  const [row] = await getDb()
    .update(schema.documents)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}

export async function deleteDocumentRow(id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.documents)
    .where(eq(schema.documents.id, id))
    .returning({ id: schema.documents.id });
  return rows.length > 0;
}

/** Documents the user owns, most recently updated first. */
export async function listOwnedDocuments(ownerId: string): Promise<Document[]> {
  return getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.ownerId, ownerId))
    .orderBy(desc(schema.documents.updatedAt));
}

export type SharedDocument = {
  document: Document;
  role: DocumentRole;
};

/** Documents shared *with* the user, most recently updated first. */
export async function listSharedDocuments(userId: string): Promise<SharedDocument[]> {
  const rows = await getDb()
    .select({ document: schema.documents, role: schema.documentMembers.role })
    .from(schema.documentMembers)
    .innerJoin(schema.documents, eq(schema.documentMembers.documentId, schema.documents.id))
    .where(eq(schema.documentMembers.userId, userId))
    .orderBy(desc(schema.documents.updatedAt));

  return rows.map((row) => ({ document: row.document, role: row.role }));
}

export type MemberWithUser = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: DocumentRole;
  createdAt: Date;
};

export async function listMembers(documentId: string): Promise<MemberWithUser[]> {
  const rows = await getDb()
    .select({
      id: schema.documentMembers.id,
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.documentMembers.role,
      createdAt: schema.documentMembers.createdAt,
    })
    .from(schema.documentMembers)
    .innerJoin(schema.users, eq(schema.documentMembers.userId, schema.users.id))
    .where(eq(schema.documentMembers.documentId, documentId))
    .orderBy(schema.documentMembers.createdAt);

  return rows;
}

export async function findMembership(
  documentId: string,
  userId: string,
): Promise<DocumentMember | null> {
  const rows = await getDb()
    .select()
    .from(schema.documentMembers)
    .where(
      and(
        eq(schema.documentMembers.documentId, documentId),
        eq(schema.documentMembers.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Adds a member, or updates their role when the membership already exists. */
export async function upsertMember(
  documentId: string,
  userId: string,
  role: DocumentRole,
): Promise<DocumentMember> {
  const [row] = await getDb()
    .insert(schema.documentMembers)
    .values({ documentId, userId, role })
    .onConflictDoUpdate({
      target: [schema.documentMembers.documentId, schema.documentMembers.userId],
      set: { role },
    })
    .returning();
  return row;
}

export async function updateMemberRole(
  documentId: string,
  userId: string,
  role: DocumentRole,
): Promise<DocumentMember | null> {
  const [row] = await getDb()
    .update(schema.documentMembers)
    .set({ role })
    .where(
      and(
        eq(schema.documentMembers.documentId, documentId),
        eq(schema.documentMembers.userId, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteMember(documentId: string, userId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.documentMembers)
    .where(
      and(
        eq(schema.documentMembers.documentId, documentId),
        eq(schema.documentMembers.userId, userId),
      ),
    )
    .returning({ id: schema.documentMembers.id });
  return rows.length > 0;
}

