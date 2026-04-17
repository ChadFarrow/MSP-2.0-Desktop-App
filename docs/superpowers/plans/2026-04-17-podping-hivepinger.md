# Podping via self-hosted hivepinger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PR #47's podping.cloud scaffolding with a self-hosted `podping-hivepinger` Railway deployment, and add a manual "Send Podping" row to SaveModal.

**Architecture:** MSP's `notifyPodping()` calls a Railway service (unmodified `podping-hivepinger` behind a Caddy bearer-auth sidecar) which queues and broadcasts `podping` `custom_json` ops to Hive. Auto-fire on hosted feed create/update stays; manual pings come through a new `/api/podping` path exposed via a SaveModal row.

**Tech Stack:** TypeScript 5.9, React 19, Vercel serverless (Node 22), vitest 4, Docker Compose on Railway, Caddy 2, brianoflondon/podping-hivepinger.

**Spec:** [`docs/superpowers/specs/2026-04-17-podping-hivepinger-design.md`](../specs/2026-04-17-podping-hivepinger-design.md)

**Starting state:** Branch `claude/evaluate-pypodping-alternative-4SXWh`, PR #47 open. `notifyPodping()` exists in `api/_utils/feedUtils.ts` and targets `https://podping.cloud/` with a `PODPING_TOKEN`. Auto-fire hookup in `notifyPodcastIndex()` and the `api/podping.ts` endpoint are already wired. This plan renames env vars, repoints the URL, adds auth, adds a rate limiter, adds a SaveModal row.

**Test coverage note:** No component tests for the SaveModal row — `@testing-library/react` is not in `devDependencies` and there are zero existing React component tests in the codebase. Adding that stack is out of scope. Manual browser verification + TypeScript strictness is the coverage for the UI layer.

---

## Files Touched

**Railway service repo (new, sibling directory `/Users/chad-mini/Vibe/msp-podping-service/`):**
- Create: `compose.yml`
- Create: `Caddyfile`
- Create: `README.md`
- Create: `.gitignore`

**MSP repo (`/Users/chad-mini/Vibe/MSP-2.0`):**
- Modify: `api/_utils/feedUtils.ts` — repoint `notifyPodping()` at Railway, Bearer auth, new env vars
- Create: `api/_utils/feedUtils.test.ts` — unit tests for `notifyPodping()`
- Create: `api/_utils/rateLimiter.ts` — in-memory LRU rate limiter module
- Create: `api/_utils/rateLimiter.test.ts` — unit tests for rate limiter
- Modify: `api/podping.ts` — both-env-var check, rate limit wrap
- Create: `api/podping.test.ts` — unit tests for endpoint
- Modify: `src/components/modals/SaveModal.tsx` — new "Send Podping" mode row + help popup entry
- Modify: `CLAUDE.md` — rewrite podping section, update env var list

---

## Task 1: Scaffold Railway service repo

**Files:**
- Create: `/Users/chad-mini/Vibe/msp-podping-service/compose.yml`
- Create: `/Users/chad-mini/Vibe/msp-podping-service/Caddyfile`
- Create: `/Users/chad-mini/Vibe/msp-podping-service/README.md`
- Create: `/Users/chad-mini/Vibe/msp-podping-service/.gitignore`

- [ ] **Step 1: Create directory and initialize git**

```bash
mkdir -p /Users/chad-mini/Vibe/msp-podping-service
cd /Users/chad-mini/Vibe/msp-podping-service
git init -b main
```

- [ ] **Step 2: Write `compose.yml`**

Create `/Users/chad-mini/Vibe/msp-podping-service/compose.yml`:

```yaml
services:
  hivepinger:
    image: ghcr.io/brianoflondon/podping-hivepinger:v1.0.0  # replace with a verified tag before deploy; never :latest
    environment:
      HIVE_ACCOUNT_NAME: ${HIVE_ACCOUNT_NAME}
      HIVE_POSTING_KEY: ${HIVE_POSTING_KEY}
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "${PORT:-8080}:8080"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    environment:
      PODPING_SHARED_SECRET: ${PODPING_SHARED_SECRET}
    depends_on:
      - hivepinger
    restart: unless-stopped
```

Note on the image tag: before deploy, run `docker pull ghcr.io/brianoflondon/podping-hivepinger:v1.0.0` to confirm the tag resolves. If it doesn't exist, check the GitHub Packages page on the hivepinger repo and pick the newest stable tag; update the compose file before pushing. `:latest` is explicitly disallowed to prevent silent upstream drift.

- [ ] **Step 3: Write `Caddyfile`**

Create `/Users/chad-mini/Vibe/msp-podping-service/Caddyfile`:

```caddy
:8080 {
    handle /health {
        respond "ok" 200
    }

    @authorized header Authorization "Bearer {$PODPING_SHARED_SECRET}"
    handle @authorized {
        reverse_proxy hivepinger:1820
    }

    respond "Unauthorized" 401
}
```

- [ ] **Step 4: Write `.gitignore`**

Create `/Users/chad-mini/Vibe/msp-podping-service/.gitignore`:

```
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 5: Write `README.md`**

Create `/Users/chad-mini/Vibe/msp-podping-service/README.md`:

````markdown
# msp-podping-service

Self-hosted [podping-hivepinger](https://github.com/brianoflondon/podping-hivepinger) deployment for [MSP 2.0](https://github.com/ChadFarrow/MSP-2.0), fronted by Caddy for bearer-token auth.

## What it does

Receives HTTP podping requests from MSP, validates a shared bearer token, and forwards to hivepinger which queues, dedups, and broadcasts `podping` `custom_json` ops to the Hive blockchain. Podcast Index and other indexers watch Hive for podpings and re-crawl feeds when they land.

## Architecture

```
MSP (Vercel) ──Bearer──► Caddy :8080 ──► hivepinger :1820 ──► Hive
```

## Prerequisites

- A funded Hive account (minimum ~20 HP so the account has Resource Credits to post; `hiveonboard.com?ref=podping` delegates enough to start). Any Hive account can send podpings — no notifier approval is required anymore.
- The account's **posting key** (STM… prefix, never the owner or active key).

## Deploy to Railway

1. Create a new Railway project pointing at this repo.
2. Set the following service variables:
   - `HIVE_ACCOUNT_NAME` — your Hive username (no `@`)
   - `HIVE_POSTING_KEY` — posting key
   - `PODPING_SHARED_SECRET` — random 32+ char string. Generate with `openssl rand -hex 32`.
3. Deploy. Railway will build from the compose file and expose Caddy on a public URL.
4. Verify health: `curl https://<railway-url>/health` → `ok`
5. Verify auth gate: `curl -i https://<railway-url>/` → `401 Unauthorized`
6. Verify pass-through (no broadcast): `curl -H "Authorization: Bearer $SECRET" "https://<railway-url>/?url=https://example.com/feed.xml&reason=update&no_broadcast=true&detailed_response=true"` → 200 JSON

## MSP environment variables

On the MSP Vercel project, set:
- `PODPING_ENDPOINT_URL` — Railway URL with trailing slash (e.g. `https://msp-podping-abc.up.railway.app/`)
- `PODPING_BEARER_TOKEN` — same value as `PODPING_SHARED_SECRET`

## Rollback

Unset `PODPING_BEARER_TOKEN` or `PODPING_ENDPOINT_URL` on the MSP Vercel project. MSP's `notifyPodping()` silently no-ops. No redeploy needed.
````

- [ ] **Step 6: Validate compose syntax**

Run:

```bash
cd /Users/chad-mini/Vibe/msp-podping-service
docker compose config
```

Expected: a resolved compose YAML printed to stdout, no errors. If Docker isn't installed locally, substitute `docker-compose config` or skip this step — Railway will surface syntax errors on deploy.

- [ ] **Step 7: Initial commit**

```bash
cd /Users/chad-mini/Vibe/msp-podping-service
git add .
git commit -m "Scaffold podping-hivepinger Railway service

Docker Compose deployment of brianoflondon/podping-hivepinger with a
Caddy sidecar enforcing shared-bearer auth. Requires HIVE_ACCOUNT_NAME,
HIVE_POSTING_KEY, and PODPING_SHARED_SECRET at deploy time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create GitHub repo and push

**Files:** none (git/gh operations only)

- [ ] **Step 1: Create remote and push**

Run:

```bash
cd /Users/chad-mini/Vibe/msp-podping-service
gh repo create ChadFarrow/msp-podping-service --public --source=. --remote=origin --push
```

Expected: repo created at `https://github.com/ChadFarrow/msp-podping-service`, initial commit pushed to `main`.

- [ ] **Step 2: Verify push**

Run:

```bash
cd /Users/chad-mini/Vibe/msp-podping-service
git remote -v && git log --oneline
```

Expected: `origin` remote points at `github.com/ChadFarrow/msp-podping-service`, one commit on `main`.

---

## Task 3: Write failing tests for `notifyPodping()` with new env vars + Bearer auth

**Files:**
- Create: `/Users/chad-mini/Vibe/MSP-2.0/api/_utils/feedUtils.test.ts`

- [ ] **Step 1: Write the test file**

Create `api/_utils/feedUtils.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('notifyPodping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.PODPING_ENDPOINT_URL;
    delete process.env.PODPING_BEARER_TOKEN;
  });

  it('no-ops and returns { ok: false } when PODPING_ENDPOINT_URL is unset', async () => {
    process.env.PODPING_BEARER_TOKEN = 'secret';
    const { notifyPodping } = await import('./feedUtils');

    const result = await notifyPodping('https://example.com/feed.xml');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/endpoint|url/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('no-ops and returns { ok: false } when PODPING_BEARER_TOKEN is unset', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    const { notifyPodping } = await import('./feedUtils');

    const result = await notifyPodping('https://example.com/feed.xml');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/token|bearer/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends request with Bearer header and query params on success', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const { notifyPodping } = await import('./feedUtils');
    const result = await notifyPodping('https://example.com/feed.xml', {
      reason: 'update',
      medium: 'music'
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('https://podping.example/?');
    expect(calledUrl).toContain('url=https%3A%2F%2Fexample.com%2Ffeed.xml');
    expect(calledUrl).toContain('reason=update');
    expect(calledUrl).toContain('medium=music');
    expect(calledInit.method).toBe('GET');
    expect(calledInit.headers.Authorization).toBe('Bearer secret-123');
  });

  it('omits reason and medium params when not provided', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const { notifyPodping } = await import('./feedUtils');
    await notifyPodping('https://example.com/feed.xml');

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).not.toContain('reason=');
    expect(calledUrl).not.toContain('medium=');
  });

  it('returns { ok: false, status } on upstream 5xx', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'upstream error'
    });

    const { notifyPodping } = await import('./feedUtils');
    const result = await notifyPodping('https://example.com/feed.xml');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBeDefined();
  });

  it('returns { ok: false, error } on network failure', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { notifyPodping } = await import('./feedUtils');
    const result = await notifyPodping('https://example.com/feed.xml');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npx vitest run api/_utils/feedUtils.test.ts
```

Expected: tests fail because the current `notifyPodping` reads `PODPING_TOKEN` (not `PODPING_BEARER_TOKEN`) and targets the hardcoded `https://podping.cloud/` (not `PODPING_ENDPOINT_URL`). Specific expected failures: the "Bearer header" and "Bearer prefix" assertions will fail (current code sends the token without the `Bearer ` prefix), and env-var checks will pass for the wrong variable.

---

## Task 4: Refactor `notifyPodping()` to use new env vars and Bearer auth

**Files:**
- Modify: `/Users/chad-mini/Vibe/MSP-2.0/api/_utils/feedUtils.ts`

- [ ] **Step 1: Replace `notifyPodping()` implementation**

Edit `api/_utils/feedUtils.ts`. Replace the `PODPING_ENDPOINT` constant and the `notifyPodping` function body.

Remove these lines near the top:

```typescript
const PODPING_ENDPOINT = 'https://podping.cloud/';
```

Replace the existing `notifyPodping` function (currently lines 22-60 on the branch) with:

```typescript
/**
 * Submit a feed-update notification to the MSP podping-hivepinger deployment.
 * No-ops (returns ok: false) when PODPING_ENDPOINT_URL or PODPING_BEARER_TOKEN is unset
 * so callers can fire-and-forget.
 */
export async function notifyPodping(
  feedUrl: string,
  options: PodpingOptions = {}
): Promise<PodpingResult> {
  const endpoint = process.env.PODPING_ENDPOINT_URL;
  if (!endpoint) {
    return { ok: false, error: 'PODPING_ENDPOINT_URL not configured' };
  }

  const token = process.env.PODPING_BEARER_TOKEN;
  if (!token) {
    return { ok: false, error: 'PODPING_BEARER_TOKEN not configured' };
  }

  const params = new URLSearchParams({ url: feedUrl });
  if (options.reason) params.set('reason', options.reason);
  if (options.medium) params.set('medium', options.medium);

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': PODPING_USER_AGENT
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`Podping submission failed: ${response.status} ${body}`);
      return { ok: false, status: response.status, error: body || response.statusText };
    }

    return { ok: true, status: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Failed to submit podping:', message);
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npx vitest run api/_utils/feedUtils.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Run full test suite to confirm no regressions**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npm test
```

Expected: all tests pass. `pubnotify.test.ts` and xml tests should be unaffected.

- [ ] **Step 4: Commit**

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
git add api/_utils/feedUtils.ts api/_utils/feedUtils.test.ts
git commit -m "Repoint notifyPodping at self-hosted hivepinger with Bearer auth

Replace hardcoded podping.cloud endpoint and PODPING_TOKEN env var with
PODPING_ENDPOINT_URL + PODPING_BEARER_TOKEN. Prepend 'Bearer ' to the
Authorization header. Add unit tests covering unset-env short-circuits,
success, upstream 5xx, and network failure paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Write failing tests for rate limiter module

**Files:**
- Create: `/Users/chad-mini/Vibe/MSP-2.0/api/_utils/rateLimiter.test.ts`

- [ ] **Step 1: Write the test file**

Create `api/_utils/rateLimiter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { checkRateLimit, __resetRateLimiterForTests } from './rateLimiter';

describe('checkRateLimit', () => {
  beforeEach(() => {
    __resetRateLimiterForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the first request from an IP', () => {
    const result = checkRateLimit('1.2.3.4', { limit: 10, windowMs: 3600_000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('allows up to `limit` requests within the window', () => {
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit('1.2.3.4', { limit: 10, windowMs: 3600_000 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9 - i);
    }
  });

  it('blocks the (limit + 1)th request and returns retryAfterMs', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('1.2.3.4', { limit: 10, windowMs: 3600_000 });
    }
    const blocked = checkRateLimit('1.2.3.4', { limit: 10, windowMs: 3600_000 });

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(3600_000);
  });

  it('tracks different IPs independently', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('1.2.3.4', { limit: 10, windowMs: 3600_000 });
    }
    const otherIp = checkRateLimit('5.6.7.8', { limit: 10, windowMs: 3600_000 });

    expect(otherIp.allowed).toBe(true);
    expect(otherIp.remaining).toBe(9);
  });

  it('resets the counter after the window expires', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('1.2.3.4', { limit: 10, windowMs: 3600_000 });
    }
    const blocked = checkRateLimit('1.2.3.4', { limit: 10, windowMs: 3600_000 });
    expect(blocked.allowed).toBe(false);

    vi.advanceTimersByTime(3600_000 + 1);

    const afterReset = checkRateLimit('1.2.3.4', { limit: 10, windowMs: 3600_000 });
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(9);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npx vitest run api/_utils/rateLimiter.test.ts
```

Expected: FAIL with import error "Cannot find module './rateLimiter'" — the module doesn't exist yet.

---

## Task 6: Implement rate limiter module

**Files:**
- Create: `/Users/chad-mini/Vibe/MSP-2.0/api/_utils/rateLimiter.ts`

- [ ] **Step 1: Implement the module**

Create `api/_utils/rateLimiter.ts`:

```typescript
interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterMs: 0 };
  }

  if (bucket.count >= options.limit) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: options.limit - bucket.count,
    retryAfterMs: 0
  };
}

/** Test-only — clears all buckets. Do not call from production code. */
export function __resetRateLimiterForTests(): void {
  buckets.clear();
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npx vitest run api/_utils/rateLimiter.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
git add api/_utils/rateLimiter.ts api/_utils/rateLimiter.test.ts
git commit -m "Add in-memory IP rate limiter for /api/podping

Module-level Map keyed by IP, fixed-window counters with auto-reset.
Acceptable for single-region Vercel deploy; if abuse emerges, swap for
Upstash later. Includes a test-only reset hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Write failing tests for `/api/podping` endpoint behavior

**Files:**
- Create: `/Users/chad-mini/Vibe/MSP-2.0/api/podping.test.ts`

- [ ] **Step 1: Write the test file**

Create `api/podping.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockReqRes(
  method: string,
  query: Record<string, string | undefined>,
  ip = '1.2.3.4'
) {
  const req = {
    method,
    query,
    body: undefined,
    headers: { 'x-forwarded-for': ip }
  } as any;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as any;

  return { req, res };
}

describe('/api/podping', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.PODPING_ENDPOINT_URL;
    delete process.env.PODPING_BEARER_TOKEN;

    // Reset the rate limiter between tests
    const { __resetRateLimiterForTests } = await import('./_utils/rateLimiter');
    __resetRateLimiterForTests();
  });

  it('rejects non-GET/POST methods with 405', async () => {
    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('DELETE', { url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 when url is missing', async () => {
    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', {});

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for invalid URL format', async () => {
    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'not-a-url' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 501 when PODPING_ENDPOINT_URL is unset', async () => {
    process.env.PODPING_BEARER_TOKEN = 'secret';

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(501);
  });

  it('returns 501 when PODPING_BEARER_TOKEN is unset', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(501);
  });

  it('returns 200 and forwards to hivepinger on success', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', {
      url: 'https://example.com/feed.xml',
      reason: 'update',
      medium: 'music'
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces upstream failure status', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      text: async () => 'down'
    });

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 429 with Retry-After header on the 11th request from same IP', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const { default: handler } = await import('./podping');

    for (let i = 0; i < 10; i++) {
      const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    }

    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('rate-limits per IP independently', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const { default: handler } = await import('./podping');

    for (let i = 0; i < 10; i++) {
      const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' }, '1.1.1.1');
      await handler(req, res);
    }

    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' }, '2.2.2.2');
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npx vitest run api/podping.test.ts
```

Expected: tests fail. Current `api/podping.ts` checks only `PODPING_TOKEN` (the 501-unset tests pass wrongly with the old name; renaming will flip them). The rate-limit tests (429 on 11th, per-IP independence) will fail because rate limiting doesn't exist yet.

---

## Task 8: Refactor `/api/podping` with both-env-var check and rate limiter

**Files:**
- Modify: `/Users/chad-mini/Vibe/MSP-2.0/api/podping.ts`

- [ ] **Step 1: Replace handler implementation**

Replace the entire contents of `api/podping.ts` with:

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { notifyPodping } from './_utils/feedUtils.js';
import { checkRateLimit } from './_utils/rateLimiter.js';

const RATE_LIMIT = { limit: 10, windowMs: 3600_000 };

function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim();
  }
  return 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const source = req.method === 'GET' ? req.query : req.body ?? {};
  const { url, reason, medium } = source as {
    url?: string;
    reason?: string;
    medium?: string;
  };

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(ip, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many podping requests. Try again later.' });
  }

  if (!process.env.PODPING_ENDPOINT_URL || !process.env.PODPING_BEARER_TOKEN) {
    return res.status(501).json({ error: 'Podping not configured on this deployment' });
  }

  const result = await notifyPodping(url, { reason, medium });
  if (!result.ok) {
    return res.status(result.status ?? 502).json({
      error: result.error ?? 'Podping submission failed'
    });
  }

  return res.status(200).json({ success: true });
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npx vitest run api/podping.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
git add api/podping.ts api/podping.test.ts
git commit -m "Gate /api/podping behind rate limiter and two-env-var check

Require both PODPING_ENDPOINT_URL and PODPING_BEARER_TOKEN before
accepting requests (501 otherwise). Apply 10/hour IP rate limit with
Retry-After header on the 429 response.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Add "Send Podping" row to SaveModal

**Files:**
- Modify: `/Users/chad-mini/Vibe/MSP-2.0/src/components/modals/SaveModal.tsx`

No automated test for this component (no React testing library in codebase). Verify manually in Step 4 below.

- [ ] **Step 1: Inspect SaveModal's mode union and state**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
grep -n "useState<'" src/components/modals/SaveModal.tsx | head -5
grep -n "mode === '" src/components/modals/SaveModal.tsx | head -20
```

Note the discriminated-union type of `mode` and the order of existing `mode === '...'` render branches. Add `'podping'` to the `mode` union and place the new render branch after the `'hosted'` branch so the option ordering in the `<select>` matches the render order.

- [ ] **Step 2: Add `'podping'` to the mode union, the dropdown, and a local state block**

In `SaveModal.tsx`:

1. Find the `useState<'local' | 'download' | ...>` declaration for `mode` and append `| 'podping'` to the union.

2. Find the `<select>` around line 561 and insert a new `<option>` after the `<option value="hosted">Host on MSP</option>` line:

```tsx
<option value="podping">Send Podping</option>
```

(Not login-gated — matches PodcastIndexModal pattern.)

3. Near the other mode-specific `useState` hooks inside the component, add:

```tsx
const [podpingUrl, setPodpingUrl] = useState('');
const [podpingReason, setPodpingReason] = useState<'update' | 'live' | 'liveEnd'>('update');
const [podpingStatus, setPodpingStatus] = useState<
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });
```

4. Find where other modes pre-fill URLs (search for `hostedFeedUrl`) and add a `useEffect` that pre-fills `podpingUrl` when `mode === 'podping'` is selected:

```tsx
useEffect(() => {
  if (mode !== 'podping') return;
  if (podpingUrl) return; // don't overwrite user edits
  const hosted = album.hostedFeedUrl;
  if (hosted) {
    setPodpingUrl(hosted);
    return;
  }
  // Fall back to Blossom pointer URL or nsite gateway URL if already published.
  // If the component already computes these elsewhere, reuse that computation.
  // Otherwise leave empty for the user to fill in.
}, [mode, album.hostedFeedUrl, podpingUrl]);
```

Note: if the component already derives Blossom/nsite URLs for other modes, reuse those variables here. The goal is to mirror whichever pre-fill logic exists for `hosted`/`blossom`/`nsite` modes so the behavior is consistent.

- [ ] **Step 3: Add the podping render branch**

After the `{mode === 'hosted' && (...)}` block, add:

```tsx
{mode === 'podping' && (
  <div style={{ marginTop: '16px' }}>
    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px' }}>
      Notify podcast apps that this feed was updated, via Podping/Hive. Indexers re-crawl the feed when they see the ping.
    </p>
    <div style={{ padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem' }}>
        Feed URL
      </label>
      <input
        type="text"
        value={podpingUrl}
        onChange={(e) => setPodpingUrl(e.target.value)}
        placeholder="https://msp.podtards.com/api/hosted/<id>.xml"
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: '4px',
          border: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          fontSize: '0.875rem',
          marginBottom: '12px'
        }}
      />
      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem' }}>
        Reason
      </label>
      <select
        value={podpingReason}
        onChange={(e) => setPodpingReason(e.target.value as 'update' | 'live' | 'liveEnd')}
        className="form-select"
        style={{ marginBottom: '12px' }}
      >
        <option value="update">update</option>
        <option value="live">live</option>
        <option value="liveEnd">liveEnd</option>
      </select>
      {podpingStatus.kind === 'success' && (
        <p style={{ color: 'var(--success-color, #22c55e)', fontSize: '0.875rem' }}>
          Podping sent.
        </p>
      )}
      {podpingStatus.kind === 'error' && (
        <p style={{ color: 'var(--error-color, #ef4444)', fontSize: '0.875rem' }}>
          {podpingStatus.message}
        </p>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 4: Wire up submit**

Find where other modes handle their submit (search for a submit/save handler — likely a function like `handleSave` or inline inside the footer `onClick`). Add a `'podping'` branch:

```tsx
if (mode === 'podping') {
  if (!podpingUrl) {
    setPodpingStatus({ kind: 'error', message: 'Feed URL is required' });
    return;
  }
  setPodpingStatus({ kind: 'loading' });
  try {
    const body: { url: string; reason: string; medium?: string } = {
      url: podpingUrl,
      reason: podpingReason
    };
    if (album.medium) body.medium = album.medium;
    const response = await fetch('/api/podping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: response.statusText }));
      setPodpingStatus({ kind: 'error', message: data.error ?? 'Podping failed' });
      return;
    }
    setPodpingStatus({ kind: 'success' });
  } catch (err) {
    setPodpingStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Network error' });
  }
  return;
}
```

Publisher mode doesn't use `album` — it uses `publisherFeed`. Both `Album.medium` (required `'music' | 'video'`) and `PublisherFeed.medium` (required `PublisherMedium`) always exist on their respective types. Adapt the submit branch to read whichever one is in scope for the current feed mode:

```tsx
const medium = isPublisherMode ? publisherFeed?.medium : album.medium;
if (medium) body.medium = medium;
```

Also make the submit button label mode-aware — find the existing button text logic and add:

```tsx
{mode === 'podping' && (podpingStatus.kind === 'loading' ? 'Sending…' : 'Send Podping')}
```

Disable the button when `mode === 'podping' && podpingStatus.kind === 'loading'`.

- [ ] **Step 5: Add help-popup entry**

Find the `<li>` around line 1191 (`<strong>Host on MSP</strong>…`) and insert a new `<li>` after it:

```tsx
<li><strong>Send Podping</strong> - Broadcast a feed-update notification via Podping/Hive. Indexers like Podcast Index watch Hive and re-crawl the feed when they see the ping.</li>
```

- [ ] **Step 6: Type-check and build**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npx tsc -b
npm run lint
```

Expected: no type errors, no lint errors.

- [ ] **Step 7: Manual verification**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npm run dev
```

Open the dev URL in a browser. Open any album in the editor. Click **Save** to open the modal. In the **Save Destination** dropdown, select **Send Podping**. Verify:

- The row renders below the dropdown
- The URL field is pre-filled if `album.hostedFeedUrl` exists, empty otherwise
- The Reason dropdown shows `update / live / liveEnd`
- Clicking **Send Podping** with dev env vars unset triggers a 501 error banner ("Podping not configured on this deployment") — the dev proxy forwards to production, so production env determines whether this errors or succeeds
- Repeatedly clicking 11 times within a minute should produce a 429 with the error message surfaced

If production has podping env vars set and the feed URL is real, the ping will actually fire. For pre-deploy testing without production credentials, you can set the env vars locally (`PODPING_ENDPOINT_URL`, `PODPING_BEARER_TOKEN`) and hit the API directly with `curl`.

- [ ] **Step 8: Commit**

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
git add src/components/modals/SaveModal.tsx
git commit -m "Add Send Podping destination to SaveModal

New 'podping' mode in the Save Destination dropdown. Pre-fills feed URL
from album.hostedFeedUrl (or related published URL), reason dropdown
defaults to update, medium auto-passed from album state when set. POSTs
to /api/podping with inline status feedback. Not login-gated — matches
the PodcastIndexModal pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Rewrite CLAUDE.md podping documentation

**Files:**
- Modify: `/Users/chad-mini/Vibe/MSP-2.0/CLAUDE.md`

- [ ] **Step 1: Update env var list**

Find the "Environment Setup" section with the env var bullet list. Replace the line:

```
- `PODPING_TOKEN` - podping.cloud Authorization token (optional; podping notifications are skipped when unset)
```

with two lines:

```
- `PODPING_ENDPOINT_URL` - Full URL to MSP's self-hosted podping-hivepinger Railway service, trailing slash (optional; podping notifications are skipped when unset)
- `PODPING_BEARER_TOKEN` - Bearer token shared with the Railway service (optional; podping notifications are skipped when unset)
```

- [ ] **Step 2: Update the Podping paragraph under Feed Hosting & Podcast Index**

Find the bullet starting with `**Podping**:` and replace it entirely with:

```
- **Podping**: `notifyPodcastIndex()` fire-and-forgets `notifyPodping()` after the PI pubnotify ping. Sends `GET ${PODPING_ENDPOINT_URL}?url=...` with `Authorization: Bearer ${PODPING_BEARER_TOKEN}`. The endpoint is MSP's self-hosted [podping-hivepinger](https://github.com/brianoflondon/podping-hivepinger) deployment on Railway (repo: `ChadFarrow/msp-podping-service`), fronted by a Caddy sidecar enforcing the bearer token. Silently no-ops when either env var is unset, so podping is off until both are configured. `/api/podping` exposes a manual endpoint behind a 10/hour per-IP rate limit; the "Send Podping" row in the SaveModal is the UI for it.
```

- [ ] **Step 3: Update API Layer section**

Find the `api/_utils/feedUtils.ts` line under "API Layer" and leave it alone (comment still accurate). Find the `podping.ts` line under "API Layer" and update it to:

```
- `podping.ts` - Broadcast feed update via self-hosted hivepinger Railway service (requires `PODPING_ENDPOINT_URL` + `PODPING_BEARER_TOKEN`); rate-limited 10/hour per IP
```

- [ ] **Step 4: Update Save Modal Destinations table**

Find the Save Modal Destinations table. The current row count mentioned in prose ("eight destinations") will become nine. Update the prose above the table from "offers eight destinations" to "offers nine destinations". Add a new row to the table between "Host on MSP" and "Save RSS feed to Nostr":

```
| Send Podping | Feed-update notification | Hive blockchain (via MSP hivepinger) | Indirectly — Podcast Index re-crawls the feed URL |
```

Also update the sentence about login-gating right after the table — the new row is NOT login-gated, so the "Login-gated options" list below stays unchanged (everything from "Save RSS feed to Nostr" down).

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
grep -n "podping.cloud\|PODPING_TOKEN" CLAUDE.md
```

Expected: zero matches (all old references replaced).

Then:

```bash
git add CLAUDE.md
git commit -m "Document self-hosted hivepinger podping architecture in CLAUDE.md

Replace all podping.cloud / PODPING_TOKEN references with the new
Railway hivepinger deployment, dual env vars, and the SaveModal row.
Save Modal Destinations table goes from eight to nine rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Final verification and push

**Files:** none (verification + push only)

- [ ] **Step 1: Run full test suite**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npm test
```

Expected: all tests pass. New test files: `feedUtils.test.ts` (6), `rateLimiter.test.ts` (5), `podping.test.ts` (9).

- [ ] **Step 2: Build and lint**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
npm run build
npm run lint
```

Expected: build succeeds, lint clean.

- [ ] **Step 3: Confirm no lingering references**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
grep -rn "podping.cloud\|PODPING_TOKEN" --include="*.ts" --include="*.tsx" --include="*.md" .
```

Expected: zero matches in source files (only matches, if any, should be in git history or this plan itself under `docs/superpowers/`).

- [ ] **Step 4: Push branch and update PR**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
git push
```

Then update the PR title and body:

```bash
gh pr edit 47 --title "Replace podping.cloud with self-hosted hivepinger + SaveModal row" --body "$(cat <<'EOF'
Pivots PR #47 away from podping.cloud to a self-hosted
[podping-hivepinger](https://github.com/brianoflondon/podping-hivepinger)
deployment on Railway, fronted by Caddy for bearer auth.

## Changes

- `notifyPodping()` now targets `PODPING_ENDPOINT_URL` with
  `Authorization: Bearer $PODPING_BEARER_TOKEN` (replaces the old
  `PODPING_TOKEN` + hardcoded podping.cloud URL).
- `/api/podping` gains a 10/hour per-IP rate limit (in-memory, single
  instance — acceptable for current scale).
- New "Send Podping" destination in SaveModal with pre-filled URL,
  reason dropdown, and inline status.
- Railway service scaffolded in a separate repo:
  [ChadFarrow/msp-podping-service](https://github.com/ChadFarrow/msp-podping-service).
- Unit tests added for `notifyPodping`, rate limiter, and the podping
  endpoint.

## Spec and plan

- Spec: `docs/superpowers/specs/2026-04-17-podping-hivepinger-design.md`
- Plan: `docs/superpowers/plans/2026-04-17-podping-hivepinger.md`

## Deploy steps

1. Verify Hive account (done) and posting key (done). Any funded Hive
   account works — Podping is permissionless.
2. Deploy the `msp-podping-service` repo to Railway with
   `HIVE_ACCOUNT_NAME`, `HIVE_POSTING_KEY`, `PODPING_SHARED_SECRET`.
3. Set `PODPING_ENDPOINT_URL` and `PODPING_BEARER_TOKEN` on the MSP
   Vercel project.
4. Smoke test `/api/podping?url=...` and watch `hiveblocks.com` for the
   custom_json op.
EOF
)"
```

- [ ] **Step 5: Verify CI green**

Run:

```bash
cd /Users/chad-mini/Vibe/MSP-2.0
gh pr checks 47
```

Expected: Vercel deployment passes.

---

## Summary

Eleven tasks total:
1. Scaffold Railway service repo files locally
2. Push Railway service to GitHub
3. Write failing tests for `notifyPodping()`
4. Refactor `notifyPodping()` with new env vars + Bearer
5. Write failing tests for rate limiter
6. Implement rate limiter module
7. Write failing tests for `/api/podping`
8. Refactor `/api/podping` with rate limit + both-env check
9. Add SaveModal "Send Podping" row
10. Rewrite CLAUDE.md podping docs
11. Final verification + PR push

After merge, the remaining work is operational (Railway deploy, Vercel env vars) — no more code changes needed.
