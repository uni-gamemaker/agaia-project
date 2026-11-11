import type { NextConfig } from 'next';

const projectRoot = import.meta.dirname;

const nextConfig: NextConfig = {
  // The browser opens the dev server through this LAN address, so allow its
  // development HMR/font resource requests as well as localhost.
  allowedDevOrigins: ['192.168.56.1'],
  /**
   * Keep Next's file tracing and Turbopack rooted at this repository.
   *
   * Without this, Next walks up the filesystem looking for a lockfile and finds an
   * unrelated `package-lock.json` in the parent home directory.
   */
  outputFileTracingRoot: projectRoot,
  turbopack: { root: projectRoot },
  /**
   * `cacheComponents` (formerly `dynamicIO`) is intentionally OFF for this app.
   *
   * Every endpoint in this API is session-authenticated and must be rendered fresh on
   * each request. With `cacheComponents` enabled, Next 16 removes the `dynamic` and
   * `revalidate` route-segment options, leaving `connection()` as the only way to opt
   * into dynamic rendering — which would tie the route handlers to the Next request
   * store and make them untestable in isolation.
   *
   * The routes use `export const dynamic = 'force-dynamic'` instead, which is explicit,
   * portable, and keeps the handlers callable directly from the test suite.
   *
   * Decision owner: ChatGPT (app shell). Revisit when the UI lane lands if the
   * marketing/shell pages want RSC caching.
   */
  cacheComponents: false,
};

export default nextConfig;
