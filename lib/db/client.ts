import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

/** One lazy libSQL client per process; shared by local SQLite and remote Turso. */
const globalForDb = globalThis as unknown as {
  ajaiaClient?: Client;
  ajaiaDb?: LibSQLDatabase<typeof schema>;
};

export function getClient(): Client {
  if (!globalForDb.ajaiaClient) {
    const url = process.env.TURSO_DATABASE_URL ?? 'file:./ajaia-local.db';
    const authToken = process.env.TURSO_AUTH_TOKEN;
    globalForDb.ajaiaClient = createClient({ url, ...(authToken ? { authToken } : {}) });
  }
  return globalForDb.ajaiaClient;
}

export function getDb(): LibSQLDatabase<typeof schema> {
  if (!globalForDb.ajaiaDb) globalForDb.ajaiaDb = drizzle(getClient(), { schema });
  return globalForDb.ajaiaDb;
}

/** Closes the client. Used by migration, seed and test teardown. */
export async function closeDb(): Promise<void> {
  if (globalForDb.ajaiaClient) {
    globalForDb.ajaiaClient.close();
    globalForDb.ajaiaClient = undefined;
    globalForDb.ajaiaDb = undefined;
  }
}

export { schema };
