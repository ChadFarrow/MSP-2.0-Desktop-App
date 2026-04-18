import { describe, it, expect } from 'vitest';
import { extractPodcastMedium } from './xmlUtils';

describe('extractPodcastMedium', () => {
  it('returns the medium value when the tag is present', () => {
    const xml = '<rss><channel><podcast:medium>music</podcast:medium></channel></rss>';
    expect(extractPodcastMedium(xml)).toBe('music');
  });

  it('returns undefined when the tag is absent', () => {
    const xml = '<rss><channel><title>No medium here</title></channel></rss>';
    expect(extractPodcastMedium(xml)).toBeUndefined();
  });

  it('returns undefined for an empty-body tag', () => {
    const xml = '<rss><channel><podcast:medium></podcast:medium></channel></rss>';
    expect(extractPodcastMedium(xml)).toBeUndefined();
  });

  it('returns the first match when the tag appears multiple times', () => {
    const xml = '<rss><channel><podcast:medium>music</podcast:medium><podcast:medium>video</podcast:medium></channel></rss>';
    expect(extractPodcastMedium(xml)).toBe('music');
  });
});
