import { describe, it, expect } from 'vitest';
import { getAudioMimeType, isKnownAudioFormat, hhmmssToSeconds, detectMediaSize, resolveMediaSize } from './audioUtils';

describe('getAudioMimeType', () => {
  it('detects mp3 as audio/mpeg', () => {
    expect(getAudioMimeType('https://example.com/track.mp3')).toBe('audio/mpeg');
  });

  it('detects flac as audio/flac', () => {
    expect(getAudioMimeType('https://example.com/track.flac')).toBe('audio/flac');
  });

  it('detects wav as audio/wav', () => {
    expect(getAudioMimeType('https://example.com/track.wav')).toBe('audio/wav');
  });

  it('detects m4a as audio/x-m4a', () => {
    expect(getAudioMimeType('https://example.com/track.m4a')).toBe('audio/x-m4a');
  });

  it('detects aac as audio/aac', () => {
    expect(getAudioMimeType('https://example.com/track.aac')).toBe('audio/aac');
  });

  it('detects ogg as audio/ogg', () => {
    expect(getAudioMimeType('https://example.com/track.ogg')).toBe('audio/ogg');
  });

  it('detects opus as audio/opus', () => {
    expect(getAudioMimeType('https://example.com/track.opus')).toBe('audio/opus');
  });

  it('detects aiff as audio/aiff', () => {
    expect(getAudioMimeType('https://example.com/track.aiff')).toBe('audio/aiff');
  });

  it('is case-insensitive', () => {
    expect(getAudioMimeType('https://example.com/Track.MP3')).toBe('audio/mpeg');
    expect(getAudioMimeType('https://example.com/Track.FLAC')).toBe('audio/flac');
  });

  it('ignores query strings and fragments', () => {
    expect(getAudioMimeType('https://example.com/track.mp3?token=abc')).toBe('audio/mpeg');
    expect(getAudioMimeType('https://example.com/track.flac#chapter1')).toBe('audio/flac');
  });

  it('falls back to audio/mpeg for unknown extensions', () => {
    expect(getAudioMimeType('https://example.com/track.xyz')).toBe('audio/mpeg');
    expect(getAudioMimeType('https://example.com/track')).toBe('audio/mpeg');
  });
});

describe('isKnownAudioFormat', () => {
  it('accepts common audio extensions', () => {
    expect(isKnownAudioFormat('https://example.com/a.mp3')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.flac')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.wav')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.m4a')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.aac')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.ogg')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.opus')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.aiff')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.aif')).toBe(true);
  });

  it('rejects non-audio extensions', () => {
    expect(isKnownAudioFormat('https://example.com/a.mp4')).toBe(false);
    expect(isKnownAudioFormat('https://example.com/a.pdf')).toBe(false);
    expect(isKnownAudioFormat('https://example.com/a')).toBe(false);
  });

  it('handles query strings and fragments', () => {
    expect(isKnownAudioFormat('https://example.com/a.mp3?x=1')).toBe(true);
    expect(isKnownAudioFormat('https://example.com/a.mp4?x=1')).toBe(false);
  });
});

describe('hhmmssToSeconds', () => {
  it('parses HH:MM:SS', () => {
    expect(hhmmssToSeconds('01:02:03')).toBe(3723);
  });

  it('parses MM:SS and bare seconds', () => {
    expect(hhmmssToSeconds('04:20')).toBe(260);
    expect(hhmmssToSeconds('45')).toBe(45);
  });

  it('returns null for empty, zero, or unparseable input', () => {
    expect(hhmmssToSeconds('')).toBeNull();
    expect(hhmmssToSeconds(undefined)).toBeNull();
    expect(hhmmssToSeconds('00:00:00')).toBeNull();
    expect(hhmmssToSeconds('not a duration')).toBeNull();
  });
});

describe('detectMediaSize', () => {
  const withFetch = async (impl: unknown, run: () => Promise<void>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl as typeof fetch;
    try { await run(); } finally { globalThis.fetch = original; }
  };

  const headResponse = (ok: boolean, contentLength: string | null) => async () => ({
    ok,
    headers: { get: (name: string) => (name === 'content-length' ? contentLength : null) }
  });

  it('reads Content-Length from a HEAD response', async () => {
    await withFetch(headResponse(true, '74784'), async () => {
      expect(await detectMediaSize('https://example.com/a.mp3')).toBe(74784);
    });
  });

  it('rejects implausibly small sizes rather than trusting them', async () => {
    await withFetch(headResponse(true, '33'), async () => {
      expect(await detectMediaSize('https://example.com/a.mp3')).toBeNull();
    });
  });

  it('returns null when the header is absent or the response is not ok', async () => {
    await withFetch(headResponse(true, null), async () => {
      expect(await detectMediaSize('https://example.com/a.mp3')).toBeNull();
    });
    await withFetch(headResponse(false, '74784'), async () => {
      expect(await detectMediaSize('https://example.com/a.mp3')).toBeNull();
    });
  });

  it('never rejects when the host blocks the request', async () => {
    await withFetch(async () => { throw new TypeError('Failed to fetch'); }, async () => {
      await expect(detectMediaSize('https://example.com/a.mp3')).resolves.toBeNull();
    });
  });
});

describe('resolveMediaSize', () => {
  const withFetch = async (impl: unknown, run: () => Promise<void>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl as typeof fetch;
    try { await run(); } finally { globalThis.fetch = original; }
  };

  it('prefers the measured size over any estimate', async () => {
    const ok = async () => ({ ok: true, headers: { get: () => '74784' } });
    await withFetch(ok, async () => {
      expect(await resolveMediaSize('https://example.com/a.mp3', 240)).toBe(74784);
    });
  });

  it('estimates from duration when the host blocks the HEAD', async () => {
    const blocked = async () => { throw new TypeError('Failed to fetch'); };
    await withFetch(blocked, async () => {
      // 240s at 128 kbps => 240 * 16000 bytes
      expect(await resolveMediaSize('https://example.com/a.mp3', 240)).toBe(3_840_000);
    });
  });

  it('falls back to a generic size when neither host nor duration is available', async () => {
    const blocked = async () => { throw new TypeError('Failed to fetch'); };
    await withFetch(blocked, async () => {
      expect(await resolveMediaSize('https://example.com/a.mp3', null)).toBe(5_000_000);
    });
  });
});
