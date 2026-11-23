const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
const authSecret = process.env.BETTER_AUTH_SECRET;
const authUrl = process.env.BETTER_AUTH_URL;
const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
const productionAuthUrlMissing = process.env.VERCEL_ENV === 'production' && !authUrl;

if (
  !url ||
  !/^libsql:\/\//i.test(url) ||
  !token ||
  !authSecret ||
  authSecret.length < 32 ||
  !gmailUser ||
  !gmailAppPassword ||
  productionAuthUrlMissing
) {
  console.error(
    '[deploy] Set TURSO_DATABASE_URL (libsql://...), TURSO_AUTH_TOKEN, BETTER_AUTH_SECRET (32+ characters), GMAIL_USER, and GMAIL_APP_PASSWORD in Vercel; set BETTER_AUTH_URL for Production before deploying.',
  );
  process.exit(1);
}
