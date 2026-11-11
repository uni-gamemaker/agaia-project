import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './lib/env';

loadEnv();

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle/turso',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? 'file:./ajaia-local.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  strict: true,
  verbose: true,
});
