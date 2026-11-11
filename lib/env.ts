import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

/**
 * Loads `.env.local` (then `.env`) for standalone scripts.
 *
 * Next.js loads these files automatically for the app itself, so this helper is only
 * used by the CLI scripts in `scripts/` (migrate, seed, demo setup). It is intentionally
 * NOT imported by anything that runs inside a request handler.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const name of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
      return;
    } catch {
      // ignore malformed/missing env file and fall through
    }
  }
}
