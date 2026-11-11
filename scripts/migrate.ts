import { loadEnv } from '../lib/env';
import { closeDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';

loadEnv();

runMigrations()
  .then(async () => {
    console.log('[db] migrations applied');
    await closeDb();
  })
  .catch(async (error) => {
    console.error('[db] migration failed:', error);
    await closeDb();
    process.exitCode = 1;
  });
