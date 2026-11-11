const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;

if (!url || !/^libsql:\/\//i.test(url) || !token) {
  console.error(
    '[deploy] Set TURSO_DATABASE_URL (libsql://...) and TURSO_AUTH_TOKEN in Vercel before deploying.',
  );
  process.exit(1);
}
