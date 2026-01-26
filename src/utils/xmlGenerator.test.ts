import { describe, it, expect } from 'vitest';
import { generateRssFeed } from './xmlGenerator';
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
