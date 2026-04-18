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
