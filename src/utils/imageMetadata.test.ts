import { describe, it, expect } from 'vitest';
import { reduceRatio, mimeFromUrl, suggestPurpose } from './imageMetadata';

describe('reduceRatio', () => {
  it('reduces common HD sizes to clean ratios', () => {
    expect(reduceRatio(1920, 1080)).toBe('16/9');
    expect(reduceRatio(1500, 1000)).toBe('3/2');
    expect(reduceRatio(1000, 1000)).toBe('1/1');
  });
  it('returns empty string when a dimension is missing', () => {
    expect(reduceRatio(0, 100)).toBe('');
    expect(reduceRatio(100, 0)).toBe('');
  });
});

describe('mimeFromUrl', () => {
  it('maps extensions to MIME types, ignoring case and query strings', () => {
    expect(mimeFromUrl('https://x.com/a.JPG')).toBe('image/jpeg');
    expect(mimeFromUrl('https://x.com/a.png?v=2')).toBe('image/png');
    expect(mimeFromUrl('https://x.com/a.webp#frag')).toBe('image/webp');
    expect(mimeFromUrl('https://x.com/a.svg')).toBe('image/svg+xml');
  });
  it('returns empty string when there is no known extension', () => {
    expect(mimeFromUrl('https://x.com/noext')).toBe('');
    expect(mimeFromUrl('https://x.com/a.heic')).toBe('');
  });
});

describe('suggestPurpose', () => {
  it('suggests artwork for square-ish images', () => {
    expect(suggestPurpose('1/1')).toBe('artwork');
  });
  it('suggests banner for wide images', () => {
    expect(suggestPurpose('16/9')).toBe('banner');
    expect(suggestPurpose('4/1')).toBe('banner');
  });
  it('returns empty for tall or invalid ratios', () => {
    expect(suggestPurpose('2/3')).toBe('');
    expect(suggestPurpose('bad')).toBe('');
  });
});
