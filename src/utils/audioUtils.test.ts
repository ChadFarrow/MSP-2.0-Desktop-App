import { describe, it, expect } from 'vitest';
import { getAudioMimeType, isKnownAudioFormat } from './audioUtils';

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
