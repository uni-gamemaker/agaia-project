import {
  documentNotFound,
  memberNotFound,
  sharingSelfNotAllowed,
  userNotFound,
  validationError,
} from '@/lib/server/http/errors';
import { requireDocumentAccess } from '@/lib/server/authz/access';
import type { Principal } from '@/lib/server/auth/principal';
import { LIMITS, emptyDoc, validateTipTapDoc } from '@/lib/tiptap';
import type { TipTapDoc } from '@/lib/tiptap';
import type { Document, DocumentRole, EffectiveRole } from '@/lib/db/schema';
import * as repository from './repository';

/**
 * Document service layer — DeepSeek-owned.
 *
 * Every function here performs the authorization check first and then delegates to the
 * repository. Route handlers stay thin: parse input → call the service → serialize.
 */

export type DocumentDto = {
  id: string;
  title: string;
  content: TipTapDoc;
  ownerId: string;
  role: EffectiveRole;
  ownership: 'owned' | 'shared';
  createdAt: string;
  updatedAt: string;
};

export function toDocumentDto(document: Document, role: EffectiveRole): DocumentDto {
  return {
    id: document.id,
    title: document.title,
    content: document.content,
    ownerId: document.ownerId,
    role,
    ownership: role === 'owner' ? 'owned' : 'shared',
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/** Validates and normalises a document title. */
export function normalizeTitle(input: unknown): string {
  if (typeof input !== 'string') {
    throw validationError('Title must be a string.', { field: 'title' });
  }
  const title = input.trim();
  if (title.length === 0) {
    throw validationError('Title cannot be empty.', { field: 'title' });
  }
  if (title.length > LIMITS.MAX_TITLE_LENGTH) {
    throw validationError(
      `Title cannot be longer than ${LIMITS.MAX_TITLE_LENGTH} characters.`,
      { field: 'title', maxLength: LIMITS.MAX_TITLE_LENGTH },
    );
  }
  return title;
}

/** Validates editor content against the TipTap schema and the documented limits. */
export function normalizeContent(input: unknown): TipTapDoc {
  const result = validateTipTapDoc(input);
  if (!result.ok) {
    throw validationError(`Document content is invalid: ${result.reason}`, {
      field: result.field,
    });
  }
  return result.value;
}

export async function createDocument(
  principal: Principal,
  input: { title: unknown; content?: unknown },
): Promise<DocumentDto> {
  const title = normalizeTitle(input.title);
  const content = input.content === undefined ? emptyDoc() : normalizeContent(input.content);

  const document = await repository.insertDocument({
    title,
    content,
    ownerId: principal.userId,
  });

  return toDocumentDto(document, 'owner');
}

export type DocumentListItem = Omit<DocumentDto, 'content'>;

/**
 * A list item deliberately omits the document body — the list endpoint must not ship
 * every document's content.
 */
function toDocumentListItem(document: Document, role: EffectiveRole): DocumentListItem {
  return {
    id: document.id,
    title: document.title,
    ownerId: document.ownerId,
    role,
    ownership: role === 'owner' ? 'owned' : 'shared',
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export async function listDocuments(principal: Principal): Promise<DocumentListItem[]> {
  const owned = await repository.listOwnedDocuments(principal.userId);
  const shared = await repository.listSharedDocuments(principal.userId);

  return [
    ...owned.map((document) => toDocumentListItem(document, 'owner')),
    ...shared.map(({ document, role }) => toDocumentListItem(document, role)),
  ];
}

export async function readDocument(
  principal: Principal,
  documentId: string,
): Promise<DocumentDto> {
  const access = await requireDocumentAccess(documentId, principal, 'read');
  return toDocumentDto(access.document, access.role);
}

export async function updateDocument(
  principal: Principal,
  documentId: string,
  input: { title?: unknown; content?: unknown },
): Promise<DocumentDto> {
  const access = await requireDocumentAccess(documentId, principal, 'write');

  const patch: { title?: string; content?: TipTapDoc } = {};
  if (input.title !== undefined) patch.title = normalizeTitle(input.title);
  if (input.content !== undefined) patch.content = normalizeContent(input.content);

  if (patch.title === undefined && patch.content === undefined) {
    throw validationError('Provide a title, content, or both.', {
      fields: ['title', 'content'],
    });
  }

  const updated = await repository.updateDocumentRow(documentId, patch);
  if (!updated) {
    // The document was deleted between the access check and the write.
    throw documentNotFound();
  }

  return toDocumentDto(updated, access.role);
}

export async function deleteDocument(principal: Principal, documentId: string): Promise<void> {
  await requireDocumentAccess(documentId, principal, 'manage');
  await repository.deleteDocumentRow(documentId);
}

export type MemberDto = {
  userId: string;
  email: string;
  displayName: string;
  role: EffectiveRole;
  createdAt: string;
};

export async function listMembers(
  principal: Principal,
  documentId: string,
): Promise<{ owner: MemberDto; members: MemberDto[] }> {
  const access = await requireDocumentAccess(documentId, principal, 'read');

  const owner = await repository.findUserById(access.document.ownerId);
  if (!owner) {
    throw documentNotFound();
  }

  const members = await repository.listMembers(documentId);

  return {
    owner: {
      userId: owner.id,
      email: owner.email,
      displayName: owner.displayName,
      role: 'owner',
      createdAt: owner.createdAt.toISOString(),
    },
    members: members.map((member) => ({
      userId: member.userId,
      email: member.email,
      displayName: member.displayName,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    })),
  };
}

export async function shareDocument(
  principal: Principal,
  documentId: string,
  input: { email: unknown; role: unknown },
): Promise<MemberDto> {
  // Only the owner may change sharing.
  await requireDocumentAccess(documentId, principal, 'manage');

  if (typeof input.email !== 'string' || input.email.trim().length === 0) {
    throw validationError('An email address is required.', { field: 'email' });
  }
  const email = input.email.trim().toLowerCase();

  const role = normalizeRole(input.role);

  if (email === principal.email.toLowerCase()) {
    throw sharingSelfNotAllowed('You already own this document.');
  }

  const target = await repository.findUserByEmail(email);
  if (!target) {
    throw userNotFound(`No user exists with the email address "${email}".`);
  }

  await repository.upsertMember(documentId, target.id, role);

  return {
    userId: target.id,
    email: target.email,
    displayName: target.displayName,
    role,
    createdAt: new Date().toISOString(),
  };
}

export async function changeMemberRole(
  principal: Principal,
  documentId: string,
  userId: string,
  input: { role: unknown },
): Promise<MemberDto> {
  await requireDocumentAccess(documentId, principal, 'manage');

  const role = normalizeRole(input.role);

  const membership = await repository.findMembership(documentId, userId);
  if (!membership) {
    throw memberNotFound();
  }

  await repository.updateMemberRole(documentId, userId, role);

  const user = await repository.findUserById(userId);

  return {
    userId,
    email: user?.email ?? '',
    displayName: user?.displayName ?? '',
    role,
    createdAt: membership.createdAt.toISOString(),
  };
}

export async function removeMember(
  principal: Principal,
  documentId: string,
  userId: string,
): Promise<void> {
  const access = await requireDocumentAccess(documentId, principal, 'manage');

  // The owner is not a member row, but guard anyway so the owner can never be removed.
  if (access.document.ownerId === userId) {
    throw memberNotFound('The document owner cannot be removed.');
  }

  const removed = await repository.deleteMember(documentId, userId);
  if (!removed) {
    throw memberNotFound();
  }
}

function normalizeRole(input: unknown): DocumentRole {
  if (input !== 'editor' && input !== 'viewer') {
    throw validationError('Role must be either "editor" or "viewer".', {
      field: 'role',
      allowed: ['editor', 'viewer'],
    });
  }
  return input;
}
