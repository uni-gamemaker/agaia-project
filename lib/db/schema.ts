import { randomUUID } from 'node:crypto';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { TipTapDoc } from '@/lib/tiptap';

/** SQLite/libSQL schema shared by local development and Turso production. */

export type DocumentRole = 'editor' | 'viewer';

const id = (name: string) => text(name).primaryKey().$defaultFn(() => randomUUID());
const date = (name: string) => integer(name, { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());

export const users = sqliteTable(
  'users',
  {
    id: id('id'),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: date('created_at'),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id('id'),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 hex of the raw cookie token. The raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    createdAt: date('created_at'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
  ],
);

export const documents = sqliteTable(
  'documents',
  {
    id: id('id'),
    title: text('title').notNull(),
    /** TipTap JSON stored as JSON text in SQLite/libSQL. */
    content: text('content', { mode: 'json' }).$type<TipTapDoc>().notNull(),
    ownerId: text('owner_id').notNull().references(() => users.id),
    createdAt: date('created_at'),
    updatedAt: date('updated_at'),
  },
  (t) => [index('documents_owner_id_idx').on(t.ownerId)],
);

export const documentMembers = sqliteTable(
  'document_members',
  {
    id: id('id'),
    documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['editor', 'viewer'] }).$type<DocumentRole>().notNull(),
    createdAt: date('created_at'),
  },
  (t) => [
    uniqueIndex('document_members_document_user_key').on(t.documentId, t.userId),
    index('document_members_user_id_idx').on(t.userId),
    index('document_members_document_id_idx').on(t.documentId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentMember = typeof documentMembers.$inferSelect;
export type NewDocumentMember = typeof documentMembers.$inferInsert;

/** The role an acting user holds on a document, including the implicit owner role. */
export type EffectiveRole = 'owner' | DocumentRole;
