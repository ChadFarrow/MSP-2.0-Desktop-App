import { describe, it, expect } from 'vitest';
import { entryFor, linkedByPublish, selectItemsToCheck } from './useLinkBackStatus';
import type { RemoteItem } from '../../../types/feed';

const GUID = 'e3e2e758-6c83-41e3-87f2-d3c64d3011f8';
const item = (feedUrl: string): RemoteItem => ({ feedGuid: feedUrl, feedUrl, medium: 'music' });
const LINKED = item('https://musicsideproject.com/api/hosted/dfc51831-1d1b-4f06-80e3-2f7051dc4052.xml');
const OPEN = item('https://musicsideproject.com/api/hosted/27735a10-3775-503d-b038-70b4b7d536ab.xml');
const results = { [`${GUID}|${LINKED.feedUrl}`]: { status: 'linked' as const } };

describe('selectItemsToCheck', () => {
  it('leaves an album marked linked by a publish alone on the automatic check', () => {
    // A re-read straight after the publish can still get the pre-publish XML.
    expect(selectItemsToCheck([LINKED, OPEN], GUID, results, true)).toEqual([OPEN]);
  });

  it('re-checks everything when the artist asks', () => {
    expect(selectItemsToCheck([LINKED, OPEN], GUID, results, false)).toEqual([LINKED, OPEN]);
  });

  it('skips platform rows, rows with no URL and duplicates', () => {
    const wavlake = item('https://wavlake.com/feed/music/a82acc2f-3440-491c-94c2-d27bebf6cfe6');
    expect(selectItemsToCheck([OPEN, wavlake, item(''), OPEN], GUID, {}, false)).toEqual([OPEN]);
  });
});

describe('entryFor', () => {
  const key = `${GUID}|${LINKED.feedUrl}`;
  const checked = { [key]: { status: 'linked' as const, albumRel: 'label' } };

  it("compares the album's role with the row's role as it is now, so an edit after the check shows at once", () => {
    expect(entryFor(checked, GUID, { ...LINKED, rel: 'label' })).toEqual({ status: 'linked', albumRel: 'label' });
    expect(entryFor(checked, GUID, { ...LINKED, rel: 'artist' })).toEqual({
      status: 'role-mismatch',
      albumRel: 'label',
      catalogRel: 'artist'
    });
  });

  it('passes a check in progress, and a row never checked, through', () => {
    expect(entryFor({ [key]: 'checking' }, GUID, LINKED)).toBe('checking');
    expect(entryFor({}, GUID, LINKED)).toBeUndefined();
  });
});

describe('linkedByPublish', () => {
  it("records the row's role as the album's, since publish wrote it there", () => {
    const published = { ...LINKED, rel: 'artist' };
    const results = { [`${GUID}|${LINKED.feedUrl}`]: linkedByPublish(published) };
    expect(entryFor(results, GUID, published)).toEqual({ status: 'linked', albumRel: 'artist' });
    // A role changed after the publish needs another one.
    expect(entryFor(results, GUID, { ...published, rel: 'label' })).toMatchObject({ status: 'role-mismatch' });
  });

  it('records no role for a row that states none', () => {
    expect(linkedByPublish(LINKED)).toEqual({ status: 'linked' });
  });
});
