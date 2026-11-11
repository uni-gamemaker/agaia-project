import { getDb, schema } from './client';

/**
 * Demo seed data.
 *
 * These accounts are for reviewer/demo use only. They are NOT production users and
 * the demo account switcher is gated behind `DEMO_MODE`.
 *
 * Fixed IDs keep the seed idempotent and make the reviewer credentials in the README
 * stable and easy to reference.
 */

export const DEMO_USERS = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'alex@demo.local',
    displayName: 'Alex Demo',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'sam@demo.local',
    displayName: 'Sam Demo',
  },
] as const;

export async function seedDemoUsers(): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.users)
    .values(DEMO_USERS.map((u) => ({ ...u })))
    .onConflictDoNothing({ target: schema.users.email });
  console.log(`[db] seeded ${DEMO_USERS.length} demo users`);
}

/**
 * Drops every row in the application tables. Used by the test harness between suites.
 * Child rows are deleted before their parent rows to respect foreign keys.
 */
export async function truncateAll(): Promise<void> {
  const db = getDb();
  await db.delete(schema.documentMembers);
  await db.delete(schema.sessions);
  await db.delete(schema.documents);
  await db.delete(schema.users);
}
