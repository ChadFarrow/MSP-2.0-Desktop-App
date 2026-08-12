// Setup for the `api` vitest project (node environment).
//
// src/test/setup.ts can't be reused: it configures window.matchMedia and
// window.localStorage, neither of which exists here. The one thing api tests
// inherit from it is the mock reset between tests — several (api/_utils/cors.test.ts,
// api/_utils/accountStore.test.ts) declare no beforeEach of their own.
beforeEach(() => {
  vi.clearAllMocks();
});
