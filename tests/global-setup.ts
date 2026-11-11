import { loadEnv } from '../lib/env';
import { closeDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';

/**
 * Vitest global setup.
 *
 * Applies the migrations to the isolated test database before any suite runs, so
 * `npm test` works from a clean checkout without a manual migration step.
 */
export default async function setup(): Promise<void> {
  loadEnv();

  process.env.TURSO_DATABASE_URL = process.env.TEST_TURSO_DATABASE_URL ?? 'file:./ajaia-test.db';
  delete process.env.TURSO_AUTH_TOKEN;

  await runMigrations();
  await closeDb();
}
