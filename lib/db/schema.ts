import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
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
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: date('created_at'),
    updatedAt: date('updated_at').notNull().default(sql`0`),
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

/** Better Auth session/account/verification storage stays separate from legacy demo sessions. */
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: id('id'),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: date('created_at'),
    updatedAt: date('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('auth_sessions_token_key').on(t.token), index('auth_sessions_user_id_idx').on(t.userId)],
);

export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: id('id'),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: date('created_at'),
    updatedAt: date('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('auth_accounts_user_id_idx').on(t.userId)],
);

export const authVerifications = sqliteTable(
  'auth_verifications',
  {
    id: id('id'),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: date('created_at'),
    updatedAt: date('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
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
