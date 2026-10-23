import { describe, it, expect, vi } from 'vitest';
import { detectVideoHeight, getVideoMimeType, isVideoUrl, matchVideoExtension, VIDEO_FILE_TYPES, VIDEO_EXTENSION_LIST } from './videoUtils';

describe('getVideoMimeType and isVideoUrl', () => {
  // The main video-feed paths use these; the table must not change them.
  it('find an extension anywhere in the URL, as before', () => {
    expect(getVideoMimeType('https://example.com/v.webm')).toBe('video/webm');
    expect(getVideoMimeType('https://example.com/v.mov?dl=1')).toBe('video/quicktime');
    expect(isVideoUrl('https://example.com/v.mp4/download')).toBe(true);
  });

  it('let another type win over .mp4, and fall back to video/mp4', () => {
    expect(getVideoMimeType('https://example.com/a.mp4/b.webm')).toBe('video/webm');
    expect(getVideoMimeType('https://example.com/stream')).toBe('video/mp4');
    expect(isVideoUrl('https://example.com/stream')).toBe(false);
  });
});

describe('matchVideoExtension', () => {
  it('reads the extension the URL ends with, ignoring a query or fragment', () => {
    expect(matchVideoExtension('https://example.com/clip.mp4')).toBe('video/mp4');
    expect(matchVideoExtension('https://example.com/clip.WEBM?sig=1#t=5')).toBe('video/webm');
    expect(matchVideoExtension('https://example.com/clip.m4v')).toBe('video/x-m4v');
  });

  it('is null for audio and for an extension only in the middle', () => {
    expect(matchVideoExtension('https://example.com/song.flac')).toBeNull();
    expect(matchVideoExtension('https://example.com/a.mov/song.mp3')).toBeNull();
    expect(matchVideoExtension('https://example.com/stream')).toBeNull();
  });
});

describe('VIDEO_FILE_TYPES', () => {
  it('lists every type matchVideoExtension can produce, once, MP4 first, naming the MIME type', () => {
    const produced = VIDEO_EXTENSION_LIST.split(', ').map(ext => matchVideoExtension(`https://example.com/a.${ext}`));
    const listed = VIDEO_FILE_TYPES.map(t => t.value);
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(produced)).toEqual(new Set(listed));
    expect(VIDEO_FILE_TYPES[0]).toEqual({ value: 'video/mp4', label: 'MP4 (video/mp4)' });
  });

  it('names the same extensions isVideoUrl knows', () => {
    expect(VIDEO_EXTENSION_LIST).toBe('mp4, m4v, webm, mov, avi, mkv');
    for (const ext of VIDEO_EXTENSION_LIST.split(', ')) {
      expect(isVideoUrl(`https://example.com/a.${ext}`)).toBe(true);
    }
  });
});

describe('detectVideoHeight', () => {
  const VIDEO_URL = 'https://example.com/video.mp4';
  // A stand-in for <video>: the test fires its events by hand.
  const fakeVideo = () => ({
    preload: '', src: '', videoHeight: 0,
    onloadedmetadata: null as null | (() => void),
    onerror: null as null | (() => void)
  });
  const detect = (el: ReturnType<typeof fakeVideo>, timeoutMs?: number) =>
    detectVideoHeight(VIDEO_URL, { create: () => el as unknown as HTMLVideoElement, timeoutMs });

  it('reads the height once the metadata loads, then lets go of the file', async () => {
    const el = fakeVideo();
    const done = detect(el);
    expect(el.preload).toBe('metadata');
    expect(el.src).toBe(VIDEO_URL);
    el.videoHeight = 1080;
    el.onloadedmetadata!();
    await expect(done).resolves.toBe(1080);
    expect(el.src).toBe('');
  });

  it('is null when the file fails to load or has no picture', async () => {
    const broken = fakeVideo();
    const failed = detect(broken);
    broken.onerror!();
    await expect(failed).resolves.toBeNull();
    const audioOnly = fakeVideo();
    const noPicture = detect(audioOnly);
    audioOnly.onloadedmetadata!();
    await expect(noPicture).resolves.toBeNull();
  });

  it('is null when the metadata takes too long', async () => {
    vi.useFakeTimers();
    try {
      const done = detect(fakeVideo(), 50);
      vi.advanceTimersByTime(50);
      await expect(done).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
