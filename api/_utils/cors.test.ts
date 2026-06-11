import { describe, it, expect, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './cors';

function createMockReqRes(method: string, origin?: string) {
  const req = {
    method,
    headers: origin ? { origin } : {}
  } as unknown as VercelRequest;

  const headers = new Map<string, string>();
  const res = {
    status: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
      return res;
    })
  } as unknown as VercelResponse;

  return { req, res, headers };
}

describe('applyCors', () => {
  it('echoes an allowed origin in restricted mode', () => {
    const { req, res, headers } = createMockReqRes('POST', 'https://msp.podtards.com');

    const handled = applyCors(req, res, { methods: 'POST, OPTIONS' });

    expect(handled).toBe(false);
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://msp.podtards.com');
    expect(headers.get('Vary')).toBe('Origin');
  });

  it('allows the Tauri desktop webview origins', () => {
    for (const origin of ['tauri://localhost', 'http://tauri.localhost']) {
      const { req, res, headers } = createMockReqRes('POST', origin);
      applyCors(req, res, { methods: 'POST, OPTIONS' });
      expect(headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
  });

  it('omits the allow-origin header for a disallowed origin', () => {
    const { req, res, headers } = createMockReqRes('POST', 'https://evil.example');

    applyCors(req, res, { methods: 'POST, OPTIONS' });

    expect(headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(headers.get('Vary')).toBe('Origin');
  });

  it('omits the allow-origin header when there is no Origin header', () => {
    const { req, res, headers } = createMockReqRes('POST');

    applyCors(req, res, { methods: 'POST, OPTIONS' });

    expect(headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('sets a wildcard origin in public mode', () => {
    const { req, res, headers } = createMockReqRes('GET', 'https://anywhere.example');

    applyCors(req, res, { methods: 'GET, OPTIONS', public: true });

    expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('handles an OPTIONS preflight and returns true', () => {
    const { req, res, headers } = createMockReqRes('OPTIONS', 'https://msp.podtards.com');

    const handled = applyCors(req, res, {
      methods: 'GET, POST, OPTIONS',
      headers: 'Content-Type, X-Edit-Token'
    });

    expect(handled).toBe(true);
    expect(headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, X-Edit-Token');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('returns false for non-OPTIONS requests', () => {
    const { req, res } = createMockReqRes('GET', 'https://msp.podtards.com');

    expect(applyCors(req, res, { methods: 'GET, OPTIONS' })).toBe(false);
    expect(res.end).not.toHaveBeenCalled();
  });
});
