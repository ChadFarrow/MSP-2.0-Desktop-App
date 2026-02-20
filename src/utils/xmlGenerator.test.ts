import { describe, it, expect } from 'vitest';
import { generateRssFeed } from './xmlGenerator';
import { parseRssFeed } from './xmlParser';
import { createEmptyAlbum } from '../types/feed';

describe('xmlGenerator publisher reference', () => {
  it('includes podcast:publisher tag when publisher is set', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: 'abc123-guid',
      feedUrl: 'https://example.com/publisher-feed.xml'
    };

    const xml = generateRssFeed(album);

    expect(xml).toContain('<podcast:publisher>');
    expect(xml).toContain('</podcast:publisher>');
    expect(xml).toContain('feedGuid="abc123-guid"');
    expect(xml).toContain('feedUrl="https://example.com/publisher-feed.xml"');
    expect(xml).toContain('medium="publisher"');
  });

  it('does not include podcast:publisher tag when publisher is not set', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';

    const xml = generateRssFeed(album);

    expect(xml).not.toContain('<podcast:publisher>');
  });

  it('does not include podcast:publisher tag when publisher has no guid or url', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: '',
      feedUrl: ''
    };

    const xml = generateRssFeed(album);

    expect(xml).not.toContain('<podcast:publisher>');
  });

  it('includes publisher with only feedUrl when feedGuid is empty', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: '',
      feedUrl: 'https://example.com/publisher-feed.xml'
    };

    const xml = generateRssFeed(album);

    expect(xml).toContain('<podcast:publisher>');
    expect(xml).toContain('feedUrl="https://example.com/publisher-feed.xml"');
    expect(xml).not.toContain('feedGuid=""');
  });

  it('includes publisher with only feedGuid when feedUrl is empty', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: 'abc123-guid',
      feedUrl: ''
    };

    const xml = generateRssFeed(album);

    expect(xml).toContain('<podcast:publisher>');
    expect(xml).toContain('feedGuid="abc123-guid"');
    expect(xml).not.toContain('feedUrl=""');
  });
});

describe('OP3 analytics prefix', () => {
  it('prefixes HTTPS enclosure URLs when op3 is enabled', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = true;
    album.podcastGuid = 'test-guid-123';
    album.tracks[0].enclosureUrl = 'https://example.com/track1.mp3';

    const xml = generateRssFeed(album);

    // HTTPS URLs have their protocol stripped after the prefix
    expect(xml).toContain('url="https://op3.dev/e,pg=test-guid-123/example.com/track1.mp3"');
  });

  it('prefixes HTTP enclosure URLs keeping full URL', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = true;
    album.podcastGuid = 'test-guid-123';
    album.tracks[0].enclosureUrl = 'http://example.com/track1.mp3';

    const xml = generateRssFeed(album);

    // HTTP URLs keep the full URL after the prefix
    expect(xml).toContain('url="https://op3.dev/e,pg=test-guid-123/http://example.com/track1.mp3"');
  });

  it('includes pg parameter when podcastGuid is set', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = true;
    album.podcastGuid = 'my-podcast-guid';
    album.tracks[0].enclosureUrl = 'https://example.com/track.mp3';

    const xml = generateRssFeed(album);

    expect(xml).toContain(',pg=my-podcast-guid/');
  });

  it('does not prefix when op3 is false', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = false;
    album.tracks[0].enclosureUrl = 'https://example.com/track1.mp3';

    const xml = generateRssFeed(album);

    expect(xml).not.toContain('op3.dev');
    expect(xml).toContain('url="https://example.com/track1.mp3"');
  });

  it('works without podcastGuid', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = true;
    album.podcastGuid = '';
    album.tracks[0].enclosureUrl = 'https://example.com/track1.mp3';

    const xml = generateRssFeed(album);

    // No ,pg= parameter when podcastGuid is empty
    expect(xml).toContain('url="https://op3.dev/e/example.com/track1.mp3"');
    expect(xml).not.toContain(',pg=');
  });
});

describe('OP3 round-trip', () => {
  it('generate with OP3 → parse → op3=true with clean URLs', () => {
    const album = createEmptyAlbum();
    album.title = 'Round Trip Album';
    album.author = 'Test Artist';
    album.description = 'Testing round-trip';
    album.op3 = true;
    album.podcastGuid = 'round-trip-guid';
    album.tracks[0].title = 'Track 1';
    album.tracks[0].enclosureUrl = 'https://example.com/track1.mp3';
    album.tracks[0].enclosureType = 'audio/mpeg';

    // Generate XML with OP3 prefixes
    const xml = generateRssFeed(album);
    expect(xml).toContain('op3.dev');

    // Parse it back
    const parsed = parseRssFeed(xml);

    // Should detect OP3 and set flag
    expect(parsed.op3).toBe(true);

    // Track URLs should be clean (OP3 prefix stripped)
    expect(parsed.tracks[0].enclosureUrl).toBe('https://example.com/track1.mp3');
    expect(parsed.tracks[0].enclosureUrl).not.toContain('op3.dev');
  });
});
