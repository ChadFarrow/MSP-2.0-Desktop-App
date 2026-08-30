import { describe, it, expect } from 'vitest';
import { collapseToPlays, topTracks, isBoostRecord, isPlayRecord } from './boostChart.js';
import type { DerivedBoost } from './boostRecord.js';

const HOUR = 3600;

function record(overrides: Partial<DerivedBoost>): DerivedBoost {
  return {
    index: 1,
    ts: 1_756_400_000,
    direction: 'incoming',
    actionName: 'stream',
    valueMsat: 1000,
    valueMsatTotal: 100000,
    app: 'Fountain',
    isMspSplit: true,
    trackSource: 'remote-guid',
    trackKey: 'guid:album:track',
    trackTitle: 'Shoot Me Down',
    trackArtist: 'THERAPY IN SESSION',
    listenerKey: 'listener-aaaa',
    hasMessageTitle: false,
    ...overrides
  };
}

describe('collapseToPlays', () => {
  it('collapses one listener streaming a track into a single play', () => {
    // Streaming sats fire about once a minute. Counting them raw would rank a
    // six-minute song above a two-minute one on a single listen each.
    const streams = [0, 60, 120, 180, 240].map((offset, i) =>
      record({ index: i + 1, ts: 1_756_400_000 + offset })
    );
    expect(collapseToPlays(streams)).toHaveLength(1);
  });

  it('starts a new play when the listener comes back later', () => {
    const streams = [
      record({ index: 1, ts: 1_756_400_000 }),
      record({ index: 2, ts: 1_756_400_000 + HOUR })
    ];
    expect(collapseToPlays(streams)).toHaveLength(2);
  });

  it('counts two listeners playing the same track at once as two plays', () => {
    const streams = [
      record({ index: 1, listenerKey: 'listener-aaaa' }),
      record({ index: 2, listenerKey: 'listener-bbbb' })
    ];
    expect(collapseToPlays(streams)).toHaveLength(2);
  });

  it('separates the same listener on two different tracks', () => {
    const streams = [
      record({ index: 1, trackKey: 'guid:album:one' }),
      record({ index: 2, trackKey: 'guid:album:two' })
    ];
    expect(collapseToPlays(streams)).toHaveLength(2);
  });

  it('falls back to app and track when no listener key is available', () => {
    // Undercounts two simultaneous listeners, which is the safe direction to be
    // wrong: it can only lower a count, never inflate one.
    const streams = [
      record({ index: 1, listenerKey: undefined }),
      record({ index: 2, listenerKey: undefined, ts: 1_756_400_060 })
    ];
    expect(collapseToPlays(streams)).toHaveLength(1);
  });

  it('ignores boosts and records that identify no track', () => {
    const mixed = [
      record({ index: 1, actionName: 'boost' }),
      record({ index: 2, actionName: 'auto' }),
      record({ index: 3, trackKey: undefined }),
      record({ index: 4 })
    ];
    expect(collapseToPlays(mixed)).toHaveLength(1);
  });

  it('collapses correctly even when the records arrive out of order', () => {
    const streams = [
      record({ index: 3, ts: 1_756_400_120 }),
      record({ index: 1, ts: 1_756_400_000 }),
      record({ index: 2, ts: 1_756_400_060 })
    ];
    expect(collapseToPlays(streams)).toHaveLength(1);
  });
});

describe('isPlayRecord / isBoostRecord', () => {
  it('treats a stream as a play and both boost kinds as boosts', () => {
    expect(isPlayRecord(record({ actionName: 'stream' }))).toBe(true);
    expect(isPlayRecord(record({ actionName: 'boost' }))).toBe(false);
    expect(isBoostRecord(record({ actionName: 'boost' }))).toBe(true);
    expect(isBoostRecord(record({ actionName: 'auto' }))).toBe(true);
    expect(isBoostRecord(record({ actionName: 'stream' }))).toBe(false);
  });
});

describe('the two lists never overlap', () => {
  it('puts every action kind in exactly one list, or neither', () => {
    // Streams are streaming sats only; auto-boosts count with boosts. A record landing
    // in both would be counted twice across the page.
    for (const kind of ['stream', 'boost', 'auto', 'invoice', 'invalid', 'unknown'] as const) {
      const r = record({ actionName: kind });
      expect(Number(isPlayRecord(r)) + Number(isBoostRecord(r)), kind).toBeLessThanOrEqual(1);
    }
    expect(isPlayRecord(record({ actionName: 'auto' }))).toBe(false);
    expect(isBoostRecord(record({ actionName: 'auto' }))).toBe(true);
  });
});

describe('merging a track that resolved under two names', () => {
  it('sums a track split across two spellings of its feed name', () => {
    // Observed live: rank 1 with 4 boosts and rank 10 with 1, same song, because Helipad
    // reported the feed as "Technopolymere - Bacalao" for some records and
    // "Technopolymere" for others. The counts belong together.
    const rows = topTracks([
      record({ index: 1, trackKey: 'guid:a', trackTitle: "When You're Smiling", trackArtist: 'Technopolymere - Bacalao' }),
      record({ index: 2, trackKey: 'guid:a', trackTitle: "When You're Smiling", trackArtist: 'Technopolymere - Bacalao' }),
      record({ index: 3, trackKey: 'link:b', trackTitle: "When You're Smiling", trackArtist: 'Technopolymere' })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    // The fuller name is the more useful label.
    expect(rows[0].trackArtist).toBe('Technopolymere - Bacalao');
  });

  it('merges two rows that are identical, which is what collided the React key', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'guid:a', trackTitle: 'Victim [432Hz]', trackArtist: 'Victim [432Hz] - Matt Finlay' }),
      record({ index: 2, trackKey: 'link:b', trackTitle: 'Victim [432Hz]', trackArtist: 'Victim [432Hz] - Matt Finlay' })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it('keeps two different songs apart even when they share a title', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'guid:a', trackTitle: 'Exist', trackArtist: 'THERAPY IN SESSION' }),
      record({ index: 2, trackKey: 'guid:b', trackTitle: 'Exist', trackArtist: 'Some Other Band' })
    ]);
    expect(rows).toHaveLength(2);
  });

  it('ignores case and accents when deciding two names are the same', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'a', trackTitle: 'Midna', trackArtist: 'Technopolymère' }),
      record({ index: 2, trackKey: 'b', trackTitle: 'MIDNA', trackArtist: 'technopolymere' })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it('leaves untitled rows alone rather than collapsing them together', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'a', trackTitle: undefined, trackArtist: undefined }),
      record({ index: 2, trackKey: 'b', trackTitle: undefined, trackArtist: undefined })
    ]);
    expect(rows).toHaveLength(2);
  });

  it('still ranks by count after merging', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'a', trackTitle: 'Loner', trackArtist: 'Band A' }),
      record({ index: 2, trackKey: 'b', trackTitle: 'Split', trackArtist: 'Band B - X' }),
      record({ index: 3, trackKey: 'c', trackTitle: 'Split', trackArtist: 'Band B' })
    ]);
    expect(rows.map(r => [r.trackTitle, r.count])).toEqual([['Split', 2], ['Loner', 1]]);
  });
});

describe('topTracks', () => {
  it('ranks by count and carries the title and artist', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'a', trackTitle: 'Shoot Me Down', trackArtist: 'THERAPY IN SESSION' }),
      record({ index: 2, trackKey: 'a', trackTitle: 'Shoot Me Down', trackArtist: 'THERAPY IN SESSION' }),
      record({ index: 3, trackKey: 'b', trackTitle: 'Vampire', trackArtist: 'Feeling the Light' })
    ]);
    expect(rows).toEqual([
      { trackKey: 'a', trackTitle: 'Shoot Me Down', trackArtist: 'THERAPY IN SESSION', count: 2 },
      { trackKey: 'b', trackTitle: 'Vampire', trackArtist: 'Feeling the Light', count: 1 }
    ]);
  });

  it('fills a title from a later record when the first one lacked one', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'a', trackTitle: undefined, trackArtist: undefined }),
      record({ index: 2, trackKey: 'a', trackTitle: 'Vampire', trackArtist: 'Feeling the Light' })
    ]);
    expect(rows[0]).toMatchObject({ count: 2, trackTitle: 'Vampire', trackArtist: 'Feeling the Light' });
  });

  it('breaks ties by title so the order is stable between requests', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'b', trackTitle: 'Zebra' }),
      record({ index: 2, trackKey: 'a', trackTitle: 'Apple' })
    ]);
    expect(rows.map(r => r.trackTitle)).toEqual(['Apple', 'Zebra']);
  });

  it('drops records that identify no track', () => {
    const many = Array.from({ length: 15 }, (_, i) => record({ index: i, trackKey: `t${i}`, trackTitle: `Track ${i}` }));
    expect(topTracks([...many, record({ index: 99, trackKey: undefined })])).toHaveLength(15);
  });

  it('returns the whole ranking when no limit is given, and a slice when one is', () => {
    // The all-time chart wants everything; a month wants a top ten. Callers say which.
    const many = Array.from({ length: 15 }, (_, i) => record({ index: i, trackKey: `t${i}`, trackTitle: `Track ${i}` }));
    expect(topTracks(many)).toHaveLength(15);
    expect(topTracks(many, 3)).toHaveLength(3);
  });
});
