import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => {
  const mod = { lookup: (...args: unknown[]) => mockLookup(...args) };
  return { ...mod, default: mod };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { getExternalUrlError, getDnsSafetyError, fetchPublicUrl, UrlSafetyError } from './urlSafety';

beforeEach(() => {
  vi.clearAllMocks();
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('getExternalUrlError', () => {
  it('allows public http(s) URLs', () => {
    expect(getExternalUrlError('https://example.com/feed.xml')).toBeNull();
    expect(getExternalUrlError('http://example.com/feed.xml')).toBeNull();
    expect(getExternalUrlError('https://8.8.8.8/feed.xml')).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(getExternalUrlError('not-a-url')).toBe('Invalid URL');
  });

  it('rejects non-http(s) schemes', () => {
    expect(getExternalUrlError('file:///etc/passwd')).toBeTruthy();
    expect(getExternalUrlError('ftp://example.com/feed.xml')).toBeTruthy();
    expect(getExternalUrlError('gopher://example.com/')).toBeTruthy();
  });

  it('rejects URLs with embedded credentials', () => {
    expect(getExternalUrlError('https://user:pass@example.com/feed.xml')).toBeTruthy();
  });

  it('rejects localhost and internal hostnames', () => {
    expect(getExternalUrlError('http://localhost/feed.xml')).toBe('Host not allowed');
    expect(getExternalUrlError('http://LOCALHOST:8080/')).toBe('Host not allowed');
    expect(getExternalUrlError('http://foo.localhost/')).toBe('Host not allowed');
    expect(getExternalUrlError('http://printer.local/')).toBe('Host not allowed');
    expect(getExternalUrlError('http://db.internal/')).toBe('Host not allowed');
  });

  it('rejects private and reserved IPv4 literals', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '255.255.255.255'
    ]) {
      expect(getExternalUrlError(`http://${host}/`), host).toBe('Host not allowed');
    }
  });

  it('allows public IPv4 literals near blocked ranges', () => {
    expect(getExternalUrlError('http://172.32.0.1/')).toBeNull();
    expect(getExternalUrlError('http://9.9.9.9/')).toBeNull();
    expect(getExternalUrlError('http://11.0.0.1/')).toBeNull();
  });

  it('rejects private IPv6 literals', () => {
    expect(getExternalUrlError('http://[::1]/feed.xml')).toBe('Host not allowed');
    expect(getExternalUrlError('http://[fc00::1]/')).toBe('Host not allowed');
    expect(getExternalUrlError('http://[fe80::1]/')).toBe('Host not allowed');
    expect(getExternalUrlError('http://[::ffff:127.0.0.1]/')).toBe('Host not allowed');
  });
});

describe('getDnsSafetyError', () => {
  it('passes hosts that resolve to public addresses', async () => {
    expect(await getDnsSafetyError('https://example.com/feed.xml')).toBeNull();
  });

  it('rejects hosts that resolve to private addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    expect(await getDnsSafetyError('https://rebind.example/')).toBe(
      'Host resolves to a private address'
    );
  });

  it('rejects hosts that fail to resolve', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await getDnsSafetyError('https://nope.example/')).toBe('Could not resolve host');
  });

  it('skips DNS for IP literals', async () => {
    expect(await getDnsSafetyError('https://8.8.8.8/feed.xml')).toBeNull();
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe('fetchPublicUrl', () => {
  it('fetches a safe URL with manual redirect mode', async () => {
    mockFetch.mockResolvedValue({ status: 200, headers: new Headers() });

    await fetchPublicUrl('https://example.com/feed.xml');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/feed.xml',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('throws UrlSafetyError for an unsafe URL without fetching', async () => {
    await expect(fetchPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(
      UrlSafetyError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('follows redirects, re-validating each hop', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: 'https://other.example/feed.xml' })
      })
      .mockResolvedValueOnce({ status: 200, headers: new Headers() });

    await fetchPublicUrl('https://example.com/feed.xml');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://other.example/feed.xml',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('blocks redirects to private addresses', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'http://127.0.0.1/admin' })
    });

    await expect(fetchPublicUrl('https://example.com/feed.xml')).rejects.toBeInstanceOf(
      UrlSafetyError
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws after too many redirects', async () => {
    mockFetch.mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'https://example.com/loop' })
    });

    await expect(fetchPublicUrl('https://example.com/feed.xml')).rejects.toThrow(
      'Too many redirects'
    );
  });
});
