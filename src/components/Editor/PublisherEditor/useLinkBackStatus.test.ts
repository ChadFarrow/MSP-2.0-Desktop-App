import { describe, it, expect } from 'vitest';
import { selectItemsToCheck } from './useLinkBackStatus';
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
