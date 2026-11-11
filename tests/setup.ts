import { loadEnv } from '../lib/env';

loadEnv();

// The test database is isolated from the development database.
process.env.TURSO_DATABASE_URL = process.env.TEST_TURSO_DATABASE_URL ?? 'file:./ajaia-test.db';
delete process.env.TURSO_AUTH_TOKEN;
