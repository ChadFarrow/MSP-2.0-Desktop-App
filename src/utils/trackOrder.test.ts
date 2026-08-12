import { describe, it, expect } from 'vitest';
import { nextTrackPubDate, resequenceTrackDates, trackOrderIssue, TRACK_DATE_STEP_MS } from './trackOrder';
import { createEmptyTrack } from '../types/feed';
import type { Track } from '../types/feed';

const ALBUM_PUB_DATE = 'Sat, 01 Feb 2025 00:00:00 GMT';

// Build a track list from pubDate strings (undefined = an unparseable date).
const makeTracks = (pubDates: (string | undefined)[]): Track[] =>
  pubDates.map((pubDate, i) => ({ ...createEmptyTrack(i + 1), pubDate: pubDate ?? 'not a date' }));

const datesOf = (tracks: Track[]) => tracks.map(t => t.pubDate);
const timesOf = (tracks: Track[]) => tracks.map(t => Date.parse(t.pubDate));

describe('nextTrackPubDate', () => {
  it('uses the album pubDate for the first track', () => {
    expect(nextTrackPubDate([], ALBUM_PUB_DATE)).toBe(ALBUM_PUB_DATE);
  });

  it('returns one step older than the current oldest track', () => {
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:02:00 GMT',
      'Sat, 01 Feb 2025 00:01:00 GMT'
    ]);
    expect(nextTrackPubDate(tracks, ALBUM_PUB_DATE)).toBe('Sat, 01 Feb 2025 00:00:00 GMT');
  });

  it('anchors on the oldest track even when the list is out of order', () => {
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:01:00 GMT',
      'Sat, 01 Feb 2025 00:05:00 GMT'
    ]);
    expect(nextTrackPubDate(tracks, ALBUM_PUB_DATE)).toBe('Sat, 01 Feb 2025 00:00:00 GMT');
  });

  it('appending repeatedly produces a strictly descending ladder', () => {
    let tracks: Track[] = [];
    for (let i = 0; i < 4; i++) {
      const pubDate = nextTrackPubDate(tracks, ALBUM_PUB_DATE);
      tracks = [...tracks, { ...createEmptyTrack(i + 1), pubDate }];
    }
    const times = timesOf(tracks);
    expect(times.every((t, i) => i === 0 || t < times[i - 1])).toBe(true);
  });

  it('falls back to now when the album pubDate is unparseable', () => {
    const before = Date.now();
    const result = Date.parse(nextTrackPubDate([], 'nonsense'));
    expect(Number.isFinite(result)).toBe(true);
    // toUTCString() truncates to whole seconds, so allow a second of slack either way.
    expect(result).toBeGreaterThanOrEqual(before - 1000);
    expect(result).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('ignores unparseable track dates', () => {
    const tracks = makeTracks([undefined, 'Sat, 01 Feb 2025 00:01:00 GMT']);
    expect(nextTrackPubDate(tracks, ALBUM_PUB_DATE)).toBe('Sat, 01 Feb 2025 00:00:00 GMT');
  });
});

describe('resequenceTrackDates', () => {
  it('flips creation-order timestamps so track 1 is newest', () => {
    // The actual bug: tracks added one at a time each got "now", so they ascend.
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:00:00 GMT',
      'Sat, 01 Feb 2025 00:01:00 GMT',
      'Sat, 01 Feb 2025 00:02:00 GMT'
    ]);
    expect(datesOf(resequenceTrackDates(tracks, ALBUM_PUB_DATE))).toEqual([
      'Sat, 01 Feb 2025 00:02:00 GMT',
      'Sat, 01 Feb 2025 00:01:00 GMT',
      'Sat, 01 Feb 2025 00:00:00 GMT'
    ]);
  });

  it('leaves an already-descending list untouched', () => {
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:02:00 GMT',
      'Sat, 01 Feb 2025 00:01:00 GMT',
      'Sat, 01 Feb 2025 00:00:00 GMT'
    ]);
    const result = resequenceTrackDates(tracks, ALBUM_PUB_DATE);
    expect(datesOf(result)).toEqual(datesOf(tracks));
    // Unchanged tracks keep their identity, so React sees no needless churn.
    result.forEach((track, i) => expect(track).toBe(tracks[i]));
  });

  it('is idempotent', () => {
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:00:00 GMT',
      'Sat, 01 Feb 2025 00:01:00 GMT',
      'Sat, 01 Feb 2025 00:02:00 GMT'
    ]);
    const once = resequenceTrackDates(tracks, ALBUM_PUB_DATE);
    expect(datesOf(resequenceTrackDates(once, ALBUM_PUB_DATE))).toEqual(datesOf(once));
  });

  it('spreads identical dates one step apart', () => {
    const tracks = makeTracks([ALBUM_PUB_DATE, ALBUM_PUB_DATE, ALBUM_PUB_DATE]);
    const times = timesOf(resequenceTrackDates(tracks, ALBUM_PUB_DATE));
    expect(times).toEqual([
      Date.parse(ALBUM_PUB_DATE),
      Date.parse(ALBUM_PUB_DATE) - TRACK_DATE_STEP_MS,
      Date.parse(ALBUM_PUB_DATE) - 2 * TRACK_DATE_STEP_MS
    ]);
  });

  it('preserves genuinely distinct dates rather than regenerating a ladder', () => {
    // An episodic feed with real weekly dates, listed oldest-first.
    const tracks = makeTracks([
      'Mon, 06 Jan 2025 00:00:00 GMT',
      'Mon, 13 Jan 2025 00:00:00 GMT',
      'Mon, 20 Jan 2025 00:00:00 GMT'
    ]);
    expect(datesOf(resequenceTrackDates(tracks, ALBUM_PUB_DATE))).toEqual([
      'Mon, 20 Jan 2025 00:00:00 GMT',
      'Mon, 13 Jan 2025 00:00:00 GMT',
      'Mon, 06 Jan 2025 00:00:00 GMT'
    ]);
  });

  it('ladders from the album pubDate when no track has a usable date', () => {
    const tracks = makeTracks([undefined, undefined]);
    expect(datesOf(resequenceTrackDates(tracks, ALBUM_PUB_DATE))).toEqual([
      'Sat, 01 Feb 2025 00:00:00 GMT',
      'Fri, 31 Jan 2025 23:59:00 GMT'
    ]);
  });

  it('always returns a strictly descending list', () => {
    const tracks = makeTracks([
      undefined,
      'Sat, 01 Feb 2025 00:00:00 GMT',
      'Sat, 01 Feb 2025 00:00:00 GMT',
      'Mon, 20 Jan 2025 00:00:00 GMT'
    ]);
    const times = timesOf(resequenceTrackDates(tracks, ALBUM_PUB_DATE));
    expect(times.every(t => Number.isFinite(t))).toBe(true);
    expect(times.every((t, i) => i === 0 || t < times[i - 1])).toBe(true);
  });

  it('is a no-op on an empty list', () => {
    expect(resequenceTrackDates([], ALBUM_PUB_DATE)).toEqual([]);
  });
});

describe('trackOrderIssue', () => {
  it('flags creation-order timestamps as a date problem', () => {
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:00:00 GMT',
      'Sat, 01 Feb 2025 00:01:00 GMT',
      'Sat, 01 Feb 2025 00:02:00 GMT'
    ]);
    expect(trackOrderIssue(tracks)).toBe('dates');
  });

  it('flags identical dates, since apps are free to order a tie either way', () => {
    expect(trackOrderIssue(makeTracks([ALBUM_PUB_DATE, ALBUM_PUB_DATE]))).toBe('dates');
  });

  it('flags unparseable dates', () => {
    expect(trackOrderIssue(makeTracks([undefined, undefined]))).toBe('dates');
  });

  it('flags descending episode numbers as a reversed import', () => {
    // A newest-first podcast feed: item 1 in the XML is the last track.
    const tracks = makeTracks([
      'Mon, 20 Jan 2025 00:00:00 GMT',
      'Mon, 13 Jan 2025 00:00:00 GMT',
      'Mon, 06 Jan 2025 00:00:00 GMT'
    ]);
    tracks.forEach((track, i) => { track.episode = tracks.length - i; });
    expect(trackOrderIssue(tracks)).toBe('reversed');
  });

  it('prefers "reversed" over "dates" when both look wrong', () => {
    const tracks = makeTracks([ALBUM_PUB_DATE, ALBUM_PUB_DATE]);
    tracks[0].episode = 2;
    tracks[1].episode = 1;
    expect(trackOrderIssue(tracks)).toBe('reversed');
  });

  it('returns null for a correctly ordered album', () => {
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:02:00 GMT',
      'Sat, 01 Feb 2025 00:01:00 GMT',
      'Sat, 01 Feb 2025 00:00:00 GMT'
    ]);
    tracks.forEach((track, i) => { track.episode = i + 1; });
    expect(trackOrderIssue(tracks)).toBeNull();
  });

  it('returns null for a single track', () => {
    expect(trackOrderIssue(makeTracks([ALBUM_PUB_DATE]))).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(trackOrderIssue([])).toBeNull();
  });

  it('does not flag ascending episode numbers on a well-dated album', () => {
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:01:00 GMT',
      'Sat, 01 Feb 2025 00:00:00 GMT'
    ]);
    tracks[0].episode = 1;
    tracks[1].episode = 2;
    expect(trackOrderIssue(tracks)).toBeNull();
  });

  it('clears once resequenceTrackDates has run', () => {
    const tracks = makeTracks([
      'Sat, 01 Feb 2025 00:00:00 GMT',
      'Sat, 01 Feb 2025 00:00:00 GMT',
      'Sat, 01 Feb 2025 00:02:00 GMT'
    ]);
    expect(trackOrderIssue(resequenceTrackDates(tracks, ALBUM_PUB_DATE))).toBeNull();
  });
});
