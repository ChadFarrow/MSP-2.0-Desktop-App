import { describe, it, expect } from 'vitest';
import { extractPodcastMedium, isWellFormedRss } from './xmlUtils';

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

describe('isWellFormedRss', () => {
  it('accepts a well-formed RSS document with an XML prolog', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Test</title></channel></rss>';
    expect(isWellFormedRss(xml)).toBe(true);
  });

  it('accepts a well-formed RSS document without a prolog', () => {
    expect(isWellFormedRss('<rss><channel><title>Test</title></channel></rss>')).toBe(true);
  });

  it('rejects truncated XML', () => {
    expect(isWellFormedRss('<?xml version="1.0"?><rss><channel><title>Cut off')).toBe(false);
  });

  it('rejects mismatched tags', () => {
    expect(isWellFormedRss('<rss><channel><title>Test</wrong></channel></rss>')).toBe(false);
  });

  it('rejects HTML and plain text', () => {
    expect(isWellFormedRss('<!DOCTYPE html><html><body>hi</body></html>')).toBe(false);
    expect(isWellFormedRss('just some text')).toBe(false);
  });

  it('rejects well-formed XML whose root is not <rss>', () => {
    expect(isWellFormedRss('<?xml version="1.0"?><feed><title>Atom</title></feed>')).toBe(false);
  });
});
