import { describe, it, expect } from 'vitest';
import { collapseToPlays, topTracks, topArtists, isBoostRecord, isPlayRecord } from './boostChart.js';
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
  it('does not join two songs a listener streamed under one shared boost link', () => {
    const streams = [
      record({ index: 1, ts: 1_756_400_000, trackSource: 'boost-link', trackKey: 'link:shared', trackTitle: 'Copenhagen Time' }),
      record({ index: 2, ts: 1_756_400_060, trackSource: 'boost-link', trackKey: 'link:shared', trackTitle: 'Contrails' })
    ];
    expect(collapseToPlays(streams)).toHaveLength(2);
  });

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
    // And the row says what it absorbed, so a wrong merge can be spotted.
    expect(rows[0].mergedFrom).toEqual(['Technopolymere']);
  });

  it('merges an artist-only spelling into "Album - Artist", and an album-only one too', () => {
    // Observed live: "Copenhagen Time" charted three times — as "Kulture Collection -
    // Matt Finlay" (the message's "album - artist"), "Kulture Collection" (Podcast Index's
    // feed title) and "Matt Finlay". Same title, same artist: one song.
    const rows = topTracks([
      ...Array.from({ length: 4 }, (_, i) => record({ index: i, trackKey: 'link:a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay' })),
      ...Array.from({ length: 6 }, (_, i) => record({ index: 10 + i, trackKey: 'guid:b', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection' })),
      ...Array.from({ length: 4 }, (_, i) => record({ index: 20 + i, trackKey: 'title:c', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' }))
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(14);
    expect(rows[0].trackArtist).toBe('Kulture Collection - Matt Finlay');
    expect(rows[0].mergedFrom).toEqual(['Kulture Collection', 'Matt Finlay']);
  });

  it('keeps an artist apart from a longer name that merely ends with the same word', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'a', trackTitle: 'Lord Have Mercy', trackArtist: 'Right Said Fred' }),
      record({ index: 2, trackKey: 'b', trackTitle: 'Lord Have Mercy', trackArtist: 'Fred' })
    ]);
    expect(rows).toHaveLength(2);
  });

  it('cannot join an album-only and an artist-only spelling without a row naming both', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'a', trackTitle: 'Safe And Effective', trackArtist: 'Kulture Collection' }),
      record({ index: 2, trackKey: 'b', trackTitle: 'Safe And Effective', trackArtist: 'Matt Finlay' })
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.mergedFrom === undefined)).toBe(true);
  });

  it('merges two rows that are identical, which is what collided the React key', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'guid:a', trackTitle: 'Victim [432Hz]', trackArtist: 'Victim [432Hz] - Matt Finlay' }),
      record({ index: 2, trackKey: 'link:b', trackTitle: 'Victim [432Hz]', trackArtist: 'Victim [432Hz] - Matt Finlay' })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    // Identical spellings are certain, so they carry no mark to review.
    expect(rows[0].mergedFrom).toBeUndefined();
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
    expect(rows.map(({ trackKey, trackTitle, trackArtist, count }) => ({ trackKey, trackTitle, trackArtist, count }))).toEqual([
      { trackKey: 'a', trackTitle: 'Shoot Me Down', trackArtist: 'THERAPY IN SESSION', count: 2 },
      { trackKey: 'b', trackTitle: 'Vampire', trackArtist: 'Feeling the Light', count: 1 }
    ]);
  });

  it('keeps two songs apart when an app gives them the same boost link', () => {
    // Observed live: v4vmusic sent one boost link with six different songs; keyed on the
    // link alone, the chart summed them under whichever title came first.
    const rows = topTracks([
      record({ index: 1, trackSource: 'boost-link', trackKey: 'link:shared', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' }),
      record({ index: 2, trackSource: 'boost-link', trackKey: 'link:shared', trackTitle: 'Contrails', trackArtist: 'Matt Finlay' }),
      record({ index: 3, trackSource: 'boost-link', trackKey: 'link:shared', trackTitle: 'Contrails', trackArtist: 'Matt Finlay' })
    ]);
    expect(rows.map(r => [r.trackTitle, r.count])).toEqual([['Contrails', 2], ['Copenhagen Time', 1]]);
  });

  it('never gives an untitled boost on a shared link to whichever song came first', () => {
    const rows = topTracks([
      record({ index: 1, trackSource: 'boost-link', trackKey: 'link:shared', trackTitle: 'That Old Thing', trackArtist: 'MezzaForte' }),
      record({ index: 2, trackSource: 'boost-link', trackKey: 'link:shared', trackTitle: undefined, trackArtist: undefined })
    ]);
    expect(rows.find(r => r.trackTitle === 'That Old Thing')?.count).toBe(1);
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

describe('listeners on a row', () => {
  it('counts each listener once, however often they sent support', () => {
    const rows = topTracks([
      record({ index: 1, listenerKey: 'listener-aaaa' }),
      record({ index: 2, listenerKey: 'listener-aaaa' }),
      record({ index: 3, listenerKey: 'listener-bbbb' })
    ]);
    expect(rows[0].count).toBe(3);
    expect(rows[0].listenerKeys.size).toBe(2);
    expect(rows[0].unattributed).toBe(0);
  });

  it('counts a record that named no sender as unattributed, not as a listener', () => {
    const rows = topTracks([
      record({ index: 1, listenerKey: 'listener-aaaa' }),
      record({ index: 2, listenerKey: undefined })
    ]);
    expect(rows[0].listenerKeys.size).toBe(1);
    expect(rows[0].unattributed).toBe(1);
  });

  it('keeps one listener once when two spellings of their song merge', () => {
    const rows = topTracks([
      record({ index: 1, trackKey: 'link:a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay', listenerKey: 'listener-aaaa' }),
      record({ index: 2, trackKey: 'guid:b', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay', listenerKey: 'listener-aaaa' }),
      record({ index: 3, trackKey: 'guid:b', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay', listenerKey: undefined })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].listenerKeys.size).toBe(1);
    expect(rows[0].unattributed).toBe(1);
  });

  it('keeps the earliest time any spelling of the song was seen', () => {
    const rows = topTracks([
      record({ index: 1, ts: 2000, trackKey: 'link:a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay' }),
      record({ index: 2, ts: 1000, trackKey: 'guid:b', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' })
    ]);
    expect(rows[0].firstTs).toBe(1000);
    expect([...rows[0].chartKeys].sort()).toEqual(['guid:b', 'link:a']);
  });
});

describe('topArtists', () => {
  function song(index: number, title: string, artist: string | undefined, extra: Partial<DerivedBoost> = {}) {
    return record({ index, trackKey: `guid:${title}`, trackTitle: title, trackArtist: artist, ...extra });
  }

  it("adds up an artist's songs, whether or not the label also names the album", () => {
    const artists = topArtists(topTracks([
      song(1, 'Copenhagen Time', 'Kulture Collection - Matt Finlay'),
      song(2, 'Copenhagen Time', 'Kulture Collection - Matt Finlay'),
      song(3, 'Contrails', 'Matt Finlay'),
      song(4, 'Vampire', 'Feeling the Light')
    ]));
    expect(artists.map(a => [a.artist, a.count, a.songs])).toEqual([
      ['Matt Finlay', 3, 2],
      ['Feeling the Light', 1, 1]
    ]);
    // Reading the artist out of "Album - Artist" is the rule, not a guess: nothing to mark.
    expect(artists[0].mergedFrom).toBeUndefined();
  });

  it('gives an album-only label to the one artist a row names for that album, and marks it', () => {
    // Podcast Index gives a feed title — the album — where the message gives "Album - Artist".
    const artists = topArtists(topTracks([
      song(1, 'Copenhagen Time', 'Kulture Collection - Matt Finlay'),
      song(2, 'Safe And Effective', 'Kulture Collection')
    ]));
    expect(artists).toHaveLength(1);
    expect(artists[0]).toMatchObject({ artist: 'Matt Finlay', count: 2, songs: 2, mergedFrom: ['Kulture Collection'] });
  });

  it('leaves an album name that several artists use on its own row', () => {
    // Many artists release a "Singles" feed; an album-only "Singles" could be any of them.
    const artists = topArtists(topTracks([
      song(1, 'ACID', 'Singles - Horseheads'),
      song(2, 'Other Song', 'Singles - Some Band'),
      song(3, 'Mystery', 'Singles')
    ]));
    expect(artists.map(a => a.artist).sort()).toEqual(['Horseheads', 'Singles', 'Some Band']);
  });

  it("counts a listener once across all of an artist's songs", () => {
    const artists = topArtists(topTracks([
      song(1, 'Copenhagen Time', 'Matt Finlay', { listenerKey: 'listener-aaaa' }),
      song(2, 'Contrails', 'Matt Finlay', { listenerKey: 'listener-aaaa' }),
      song(3, 'Contrails', 'Matt Finlay', { listenerKey: undefined })
    ]));
    expect(artists[0].listenerKeys.size).toBe(1);
    expect(artists[0].unattributed).toBe(1);
  });

  it('joins spellings of one artist that differ only in case and accents', () => {
    const artists = topArtists(topTracks([
      song(1, 'Midna', 'Technopolymère'),
      song(2, 'Bakalator', 'TECHNOPOLYMERE')
    ]));
    expect(artists).toHaveLength(1);
    expect(artists[0].count).toBe(2);
  });

  it('skips songs with no title or no artist', () => {
    const artists = topArtists(topTracks([
      song(1, 'Nameless', undefined),
      record({ index: 2, trackKey: 'guid:x', trackTitle: undefined, trackArtist: 'Ghost' })
    ]));
    expect(artists).toEqual([]);
  });

  it('ranks by count, then by name', () => {
    const artists = topArtists(topTracks([
      song(1, 'One', 'Zebra'),
      song(2, 'Two', 'Apple'),
      song(3, 'Three', 'Mango'),
      song(4, 'Four', 'Mango')
    ]));
    expect(artists.map(a => a.artist)).toEqual(['Mango', 'Apple', 'Zebra']);
  });
});

describe('counts per month', () => {
  const JUL = Math.floor(Date.UTC(2026, 6, 12) / 1000);
  const AUG = Math.floor(Date.UTC(2026, 7, 12) / 1000);

  it("counts a row's records month by month", () => {
    const rows = topTracks([
      record({ index: 1, ts: JUL }),
      record({ index: 2, ts: AUG }),
      record({ index: 3, ts: AUG })
    ]);
    expect(Object.fromEntries(rows[0].byMonth)).toEqual({ '2026-07': 1, '2026-08': 2 });
  });

  it('adds up the months of two spellings that merge into one song', () => {
    const rows = topTracks([
      record({ index: 1, ts: JUL, trackKey: 'link:a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay' }),
      record({ index: 2, ts: AUG, trackKey: 'guid:b', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' }),
      record({ index: 3, ts: AUG, trackKey: 'link:a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay' })
    ]);
    expect(rows).toHaveLength(1);
    expect(Object.fromEntries(rows[0].byMonth)).toEqual({ '2026-07': 1, '2026-08': 2 });
  });

  it("adds up an artist's songs month by month", () => {
    const artists = topArtists(topTracks([
      record({ index: 1, ts: JUL, trackKey: 'a', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' }),
      record({ index: 2, ts: AUG, trackKey: 'b', trackTitle: 'Contrails', trackArtist: 'Matt Finlay' }),
      record({ index: 3, ts: AUG, trackKey: 'a', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' })
    ]));
    expect(Object.fromEntries(artists[0].byMonth)).toEqual({ '2026-07': 1, '2026-08': 2 });
  });
});
