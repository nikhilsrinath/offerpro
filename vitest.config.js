import { defineConfig } from 'vitest/config';

// Deliberately NOT vite.config.js. That config loads .env, mutates process.env
// and registers dev-server middleware for the api/ routes; none of it belongs in
// a unit-test run, and all of it fails noisily without secrets present.
export default defineConfig({
  test: {
    environment: 'node',
    // api/ is included as well as src/: the serverless handlers hold the
    // recipient validation and the header-injection guards, which are exactly
    // the parts worth a unit test. They import lazily (supabaseAdmin() is only
    // called inside a request), so importing a handler here starts nothing.
    include: ['src/**/*.test.{js,jsx,ts,tsx}', 'api/**/*.test.{js,ts}'],
  },
});
