import { betterAuth } from 'better-auth/minimal';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { getDb, schema } from '@/lib/db/client';
import { sendAccountEmail } from './email';

const baseURL = process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
const isProduction = process.env.NODE_ENV === 'production';
const authBaseURL = isProduction
  ? baseURL
  : {
      allowedHosts: ['localhost:*', '127.0.0.1:*'],
      protocol: 'http' as const,
      fallback: baseURL,
    };
const isProductionBuild = process.env.NEXT_PHASE === 'phase-production-build';
const secret = process.env.BETTER_AUTH_SECRET ||
  (process.env.NODE_ENV === 'production' && !isProductionBuild
    ? ''
    : 'local-development-only-secret-change-me-32-chars');

if (process.env.NODE_ENV === 'production' && secret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
}

export const betterAuthInstance = betterAuth({
  appName: 'Ajaia',
  baseURL: authBaseURL,
  secret,
  trustedOrigins: isProduction
    ? [baseURL]
    : [baseURL, 'http://localhost:*', 'http://127.0.0.1:*'],
  database: drizzleAdapter(getDb(), {
    provider: 'sqlite',
    schema: {
      ...schema,
      user: schema.users,
      users: schema.users,
      session: schema.authSessions,
      auth_sessions: schema.authSessions,
      account: schema.authAccounts,
      auth_accounts: schema.authAccounts,
      verification: schema.authVerifications,
      auth_verifications: schema.authVerifications,
    },
    transaction: true,
  }),
  user: {
    modelName: 'users',
    fields: { name: 'displayName' },
  },
  session: { modelName: 'auth_sessions' },
  account: { modelName: 'auth_accounts' },
  verification: { modelName: 'auth_verifications' },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAccountEmail({
        to: user.email,
        subject: 'Reset your Ajaia password',
        text: `Use this one-time link to choose a new password:\n\n${url}\n\nIf you did not request a reset, you can ignore this email.`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAccountEmail({
        to: user.email,
        subject: 'Verify your Ajaia email',
        text: `Confirm your email address to activate your account:\n\n${url}`,
      });
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (user.email.toLowerCase().endsWith('@demo.local')) {
            throw new APIError('BAD_REQUEST', { message: 'Demo account addresses are reserved.' });
          }
          return { data: user };
        },
      },
    },
  },
});
