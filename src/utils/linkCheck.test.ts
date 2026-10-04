import { describe, it, expect } from 'vitest';
import { collectLinkTargets, runLinkCheck, summarizeLinks, LINK_CHECK_LIMIT, type LinkResult, type LinkTarget } from './linkCheck';
import { checkFeed, linkIssues, type FeedSnapshot } from './feedChecks';
import { createEmptyAlbum, createEmptyPublisherFeed, createEmptyTrack } from '../types/feed';
import type { Album, Track } from '../types/feed';

const track = (n: number, partial: Partial<Track> = {}): Track => ({
  ...createEmptyTrack(n),
  enclosureUrl: `https://example.com/${n}.mp3`,
  ...partial
});

const album = (partial: Partial<Album> = {}): Album => ({
  ...createEmptyAlbum(),
  imageUrl: 'https://example.com/art.jpg',
  tracks: [track(1), track(2)],
  ...partial
});

const snapshot = (a: Album, feedType: 'album' | 'video' = 'album'): FeedSnapshot => ({ feedType, album: a, publisherFeed: null });

describe('collectLinkTargets', () => {
  it('lists art, enclosures, track art and extra images', () => {
    const a = album({
      podcastImages: [{ href: 'https://example.com/banner.jpg', purpose: 'banner' }],
      tracks: [track(1, { trackArtUrl: 'https://example.com/t1.jpg' })]
    });
    const targets = collectLinkTargets(snapshot(a));
    expect(targets.map(t => [t.url, t.kind, t.roles])).toEqual([
      ['https://example.com/art.jpg', 'image', ['artwork']],
      ['https://example.com/banner.jpg', 'image', ['extraImage']],
      ['https://example.com/1.mp3', 'audio', ['enclosure']],
      ['https://example.com/t1.jpg', 'image', ['trackArt']]
    ]);
    expect(targets[2].trackIds).toEqual([a.tracks[0].id]);
    expect(targets[2].mimeType).toBe('audio/mpeg');
  });

  it('merges a URL used in several places into one target', () => {
    const a = album({
      tracks: [track(1, { trackArtUrl: 'https://example.com/art.jpg' }), track(2, { trackArtUrl: 'https://example.com/art.jpg' })]
    });
    const art = collectLinkTargets(snapshot(a)).filter(t => t.url === 'https://example.com/art.jpg');
    expect(art).toHaveLength(1);
    expect(art[0].roles).toEqual(['artwork', 'trackArt']);
    expect(art[0].trackIds).toEqual([a.tracks[0].id, a.tracks[1].id]);
  });

  it('skips empty and non-web URLs, and trims the rest', () => {
    const a = album({ imageUrl: '', tracks: [track(1, { enclosureUrl: 'ftp://x/1.mp3' }), track(2, { enclosureUrl: ' https://example.com/2.mp3 ' })] });
    expect(collectLinkTargets(snapshot(a)).map(t => t.url)).toEqual(['https://example.com/2.mp3']);
  });

  it('probes video enclosures as video', () => {
    const a = album({ tracks: [track(1, { enclosureUrl: 'https://example.com/1.mp4', enclosureType: 'audio/mpeg' }), track(2, { enclosureType: 'video/mp4' })] });
    expect(collectLinkTargets(snapshot(a, 'video')).filter(t => t.roles.includes('enclosure')).map(t => t.kind)).toEqual(['video', 'video']);
  });

  it('lists a publisher feed\'s artwork only', () => {
    const feed: FeedSnapshot = {
      feedType: 'publisher',
      album: album(),
      publisherFeed: { ...createEmptyPublisherFeed(), imageUrl: 'https://label.example/logo.png' }
    };
    expect(collectLinkTargets(feed).map(t => t.url)).toEqual(['https://label.example/logo.png']);
  });
});

describe('runLinkCheck', () => {
  const targets = (n: number): LinkTarget[] =>
    Array.from({ length: n }, (_, i) => ({ url: `https://example.com/${i}`, kind: 'image' as const, roles: ['artwork' as const], trackIds: [] }));

  // A probe whose results the test releases by hand.
  function deferredProbe() {
    const pending: { url: string; resolve: (r: LinkResult) => void }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const probe = (target: LinkTarget) => new Promise<LinkResult>(resolve => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      pending.push({ url: target.url, resolve: r => { inFlight--; resolve(r); } });
    });
    return { probe, pending, max: () => maxInFlight };
  }
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  it('never runs more than four probes at once and reports every result', async () => {
    const { probe, pending, max } = deferredProbe();
    const results: string[] = [];
    const done = runLinkCheck(targets(10), { probe, signal: new AbortController().signal, onResult: url => results.push(url) });
    while (results.length < 10) {
      await tick();
      pending.splice(0).forEach(p => p.resolve({ status: 'ok' }));
    }
    await done;
    expect(max()).toBe(4);
    expect(results).toHaveLength(10);
  });

  it('starts nothing and reports nothing after an abort', async () => {
    const { probe, pending } = deferredProbe();
    const controller = new AbortController();
    const results: string[] = [];
    const done = runLinkCheck(targets(10), { probe, signal: controller.signal, onResult: url => results.push(url) });
    await tick();
    expect(pending).toHaveLength(4);
    controller.abort();
    pending.splice(0).forEach(p => p.resolve({ status: 'ok' }));
    await done;
    expect(results).toEqual([]);
    expect(pending).toHaveLength(0);
  });

  it('treats a probe that throws as unknown', async () => {
    const results: LinkResult[] = [];
    await runLinkCheck(targets(1), {
      probe: () => Promise.reject(new Error('boom')),
      signal: new AbortController().signal,
      onResult: (_, r) => results.push(r)
    });
    expect(results).toEqual([{ status: 'unknown', reason: 'timeout' }]);
  });
});

describe('summarizeLinks', () => {
  it('counts over the current targets only', () => {
    const a = album();
    const targets = collectLinkTargets(snapshot(a));
    const links: Record<string, LinkResult> = {
      'https://example.com/art.jpg': { status: 'ok', width: 3000, height: 3000 },
      'https://example.com/1.mp3': { status: 'broken' },
      'https://example.com/old.mp3': { status: 'broken' }
    };
    expect(summarizeLinks(targets, links)).toEqual({ total: 3, checked: 2, broken: 1, httpSkipped: 0, limited: false });
  });

  it('says when the feed has more links than one run checks', () => {
    const many = album({ tracks: Array.from({ length: LINK_CHECK_LIMIT }, (_, i) => track(i + 1)) });
    expect(summarizeLinks(collectLinkTargets(snapshot(many)), {}).limited).toBe(true);
  });
});

describe('linkIssues', () => {
  const art = (width: number, height: number) => {
    const a = album({ tracks: [] });
    const feed = snapshot(a);
    return linkIssues(collectLinkTargets(feed), { 'https://example.com/art.jpg': { status: 'ok', width, height } }, feed);
  };

  it('accepts square art from 1400 to 3000 px', () => {
    expect(art(1400, 1400)).toEqual([]);
    expect(art(3000, 3000)).toEqual([]);
  });

  it('flags art outside that range, or not square', () => {
    expect(art(1399, 1399).map(i => i.code)).toEqual(['artwork-size']);
    expect(art(3001, 3001).map(i => i.code)).toEqual(['artwork-size']);
    expect(art(1400, 1500).map(i => i.code)).toEqual(['artwork-not-square']);
    expect(art(1400, 1500)[0]).toMatchObject({ area: 'artwork', message: expect.stringContaining('1400×1500') });
  });

  it('never size-checks extra podcast:images', () => {
    const a = album({ tracks: [], podcastImages: [{ href: 'https://example.com/banner.jpg' }] });
    const feed = snapshot(a);
    expect(linkIssues(collectLinkTargets(feed), { 'https://example.com/banner.jpg': { status: 'ok', width: 3000, height: 750 } }, feed)).toEqual([]);
  });

  it('reports a broken enclosure against its track, once', () => {
    const shared = 'https://example.com/same.mp3';
    const a = album({ tracks: [track(1, { enclosureUrl: shared }), track(2, { enclosureUrl: shared })] });
    const feed = snapshot(a);
    const issues = linkIssues(collectLinkTargets(feed), { [shared]: { status: 'broken' } }, feed);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'link-broken', area: 'tracks', trackId: a.tracks[0].id });
  });

  it('ignores results for URLs the feed no longer uses, and unknown results', () => {
    const feed = snapshot(album());
    const targets = collectLinkTargets(feed);
    expect(linkIssues(targets, {
      'https://example.com/gone.mp3': { status: 'broken' },
      'https://example.com/1.mp3': { status: 'unknown', reason: 'http' }
    }, feed)).toEqual([]);
  });
});

describe('checkFeed', () => {
  it('groups every source of issues by level', () => {
    const a = album({ title: '', tracks: [track(1, { duration: '00:00:00' })] });
    const report = checkFeed(snapshot(a), [
      { code: 'explicit-legacy', level: 'outdated', area: 'feed', message: 'old' }
    ], { 'https://example.com/1.mp3': { status: 'broken' } });
    expect(report.must.map(i => i.code)).toContain('missing-title');
    expect(report.should.map(i => i.code)).toEqual(expect.arrayContaining(['duration-zero', 'link-broken']));
    expect(report.outdated.map(i => i.code)).toEqual(['explicit-legacy']);
    expect(report.links).toMatchObject({ total: 2, checked: 1, broken: 1 });
  });

  it('lists issues in editor order: file, feed, artwork, then tracks by position', () => {
    const a = album({ link: '', tracks: [track(1), track(2, { duration: '00:00:00' })] });
    const report = checkFeed(snapshot(a), [
      { code: 'transcripts-multiple', level: 'should', area: 'tracks', message: '', trackId: a.tracks[0].id },
      { code: 'xml-malformed', level: 'should', area: 'file', message: '' }
    ], { 'https://example.com/art.jpg': { status: 'broken' } });
    // track-order is about the whole list, so it sits under "Tracks" before Track 1.
    expect(report.should.map(i => i.code)).toEqual([
      'xml-malformed', 'channel-link-missing', 'link-broken', 'track-order', 'transcripts-multiple', 'duration-zero'
    ]);
  });
});
