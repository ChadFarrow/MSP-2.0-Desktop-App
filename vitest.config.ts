import { defineConfig } from 'vitest/config';
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
    ],
  },
});
