import { describe, it, expect } from 'vitest';
import { createEmptyAlbum, createEmptyVideoAlbum, createEmptyTrack, PODCAST_IMAGE_PURPOSES } from './feed';

describe('podcastImages data model', () => {
  it('initializes podcastImages to an empty array on album, video album, and track', () => {
    expect(createEmptyAlbum().podcastImages).toEqual([]);
    expect(createEmptyVideoAlbum().podcastImages).toEqual([]);
    expect(createEmptyTrack(1).podcastImages).toEqual([]);
  });

  it('exposes the canvas purpose preset for Now Playing backgrounds', () => {
    expect(PODCAST_IMAGE_PURPOSES.map(p => p.value)).toContain('canvas');
    expect(PODCAST_IMAGE_PURPOSES.map(p => p.value)).toContain('artwork');
  });
});
