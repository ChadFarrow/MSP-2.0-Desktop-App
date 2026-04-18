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
