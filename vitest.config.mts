import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load `.env.local` / `.env` for test configuration. Kept inline so the config has no
// project imports (avoids a CommonJS/ESM interop warning from Vite's config loader).
for (const name of ['.env.local', '.env']) {
  const envPath = resolve(process.cwd(), name);
  if (!existsSync(envPath)) continue;
  try {
    process.loadEnvFile(envPath);
    break;
  } catch {
    // ignore and try the next candidate
  }
}

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // The suites share one local libSQL database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      TURSO_DATABASE_URL: 'file:./ajaia-test.db',
      TURSO_AUTH_TOKEN: '',
    },
  },
  resolve: {
    alias: [{ find: /^@\//, replacement: rootDir }],
  },
});
