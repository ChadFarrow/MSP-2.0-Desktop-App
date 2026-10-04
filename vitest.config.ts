import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/*
 * Two projects, because the two halves of this repo run in different worlds.
 *
 * src/ is a React app and needs jsdom. api/ is Vercel serverless handlers, and the
 * web repo — where those files and their tests are authored — has no vitest config
 * at all, so they are written against vitest's default node environment. Running
 * them under jsdom broke synced tests in ways that had nothing to do with the code:
 * `import.meta.url` stops being a file: URL (api/_utils/urlValidation.test.ts), and
 * node builtin mocks need a `default` key they don't need in node
 * (api/verify-feed-url.test.ts). Matching upstream's environment here is what makes
 * an upstream api test land green instead of needing a per-file edit every sync.
 */

/*
 * Upstream src/ tests that are written for node, like the api tests above. They stub
 * `globalThis.localStorage` themselves, which jsdom plus setup.ts forbids — setup.ts
 * defines window.localStorage as a read-only mock — so under `src` they fail before a
 * single test runs. Listed one by one, so every other src test keeps jsdom.
 */
const NODE_SRC_TESTS = ['src/utils/nostrSigner.test.ts'];

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'src/test/'],
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'src',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, ...NODE_SRC_TESTS],
        },
      },
      {
        test: {
          name: 'api',
          environment: 'node',
          globals: true,
          // setup.ts can't be shared — it configures window. This carries over the
          // only part of it api tests actually rely on.
          setupFiles: ['./src/test/setup.node.ts'],
          include: ['api/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'src-node',
          environment: 'node',
          globals: true,
          setupFiles: ['./src/test/setup.node.ts'],
          include: NODE_SRC_TESTS,
        },
      },
    ],
  },
});
