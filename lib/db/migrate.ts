import { migrate } from 'drizzle-orm/libsql/migrator';
import { getDb } from './client';

/**
 * Applies the SQL migrations in `drizzle/turso/` to the configured libSQL database.
 *
 * Run with: `npm run db:migrate`
 */
export async function runMigrations(migrationsFolder = './drizzle/turso'): Promise<void> {
  const db = getDb();
  await migrate(db, { migrationsFolder });
}
