import { loadEnv } from '../lib/env';
import { closeDb } from '../lib/db/client';
import { seedDemoUsers } from '../lib/db/seed';

loadEnv();

seedDemoUsers()
  .then(async () => {
    await closeDb();
  })
  .catch(async (error) => {
    console.error('[db] seed failed:', error);
    await closeDb();
    process.exitCode = 1;
  });
