import { describe, it, expect } from 'vitest';
import { inspectFeedXml, describeImportError } from './feedInspect';
import { bindSourceFindings, openSourceFindings, type FeedIssue, type FeedSnapshot } from './feedChecks';
import { parseRssFeed, parsePublisherRssFeed } from './xmlParser';
import { generateRssFeed, generatePublisherRssFeed } from './xmlGenerator';
import { LEGACY_MSP_NODE_PUBKEY, MSP_SUPPORT_RECIPIENT } from '../types/feed';

const NS = 'xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/"';

/**
 * A healthy modern feed carrying every harmless extra MSP passes through
 * untouched. It must inspect clean: the panel never nags about an element just
 * because MSP doesn't model it.
 */
const CLEAN_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss ${NS} version="2.0">
  <channel>
    <atom:link href="https://artist.example/feed.xml" rel="self" type="application/rss+xml"/>
    <title>Clean</title>
    <itunes:author>Artist</itunes:author>
    <description>All good</description>
    <link>https://artist.example</link>
    <language>en</language>
    <pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>
    <podcast:medium>music</podcast:medium>
    <podcast:guid>c7d1b2a0-1111-4222-8333-444455556666</podcast:guid>
    <podcast:locked>yes</podcast:locked>
    <podcast:txt purpose="npub">npub1artist</podcast:txt>
    <podcast:txt purpose="applepodcastsverify">abc-123</podcast:txt>
    <itunes:category text="Music"><itunes:category text="Music History"/></itunes:category>
    <itunes:explicit>false</itunes:explicit>
    <image><url>https://example.com/art.jpg</url><title>Clean</title><link>https://artist.example</link></image>
    <itunes:image href="https://example.com/art.jpg"/>
    <podcast:images srcset="https://example.com/art-3000.jpg 3000w"/>
    <podcast:funding url="https://artist.example/support">Support</podcast:funding>
    <podcast:person role="vocals" group="music">Singer</podcast:person>
    <podcast:remoteItem feedGuid="aaaaaaaa-0000-4000-8000-000000000001" medium="music"/>
    <content:encoded><![CDATA[<p>Liner notes</p>]]></content:encoded>
    <podcast:value type="lightning" method="lnaddress">
      <podcast:valueRecipient name="Artist" address="artist@getalby.com" split="95" type="lnaddress"/>
      <podcast:valueRecipient name="Host" address="host@getalby.com" split="5" type="lnaddress" fee="true"/>
    </podcast:value>
    <item>
      <title>Song</title>
      <pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">song-1</guid>
      <enclosure url="https://op3.dev/e,pg=c7d1b2a0-1111-4222-8333-444455556666/example.com/1.mp3" length="3600000" type="audio/mpeg"/>
      <itunes:duration>00:03:45</itunes:duration>
      <itunes:explicit>true</itunes:explicit>
      <podcast:transcript url="https://example.com/1.srt" type="application/x-subrip"/>
      <podcast:value type="lightning" method="lnaddress">
        <podcast:valueRecipient name="Artist" address="artist@getalby.com" split="95" type="lnaddress"/>
        <podcast:valueRecipient name="Host" address="host@getalby.com" split="5" type="lnaddress" fee="true"/>
        <podcast:valueTimeSplit startTime="60" duration="30" remotePercentage="90">
          <podcast:remoteItem feedGuid="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" itemGuid="guest"/>
        </podcast:valueTimeSplit>
      </podcast:value>
    </item>
  </channel>
</rss>`;

const edit = (from: string, to: string, xml = CLEAN_FEED): string => {
  expect(xml).toContain(from);
  return xml.replace(from, to);
};

const codesOf = (issues: FeedIssue[]) => issues.map(issue => issue.code);
const find = (xml: string, code: string) => inspectFeedXml(xml).find(issue => issue.code === code);

describe('inspectFeedXml', () => {
  it('reports nothing for a modern feed full of harmless extras', () => {
    expect(inspectFeedXml(CLEAN_FEED)).toEqual([]);
  });

  it('never throws, whatever it is given', () => {
    for (const junk of ['', '<<<', 'not xml', '<html><body>page</body></html>', '<rss><channel>', '<rss/>']) {
      expect(() => inspectFeedXml(junk)).not.toThrow();
    }
    expect(inspectFeedXml('<html><body>page</body></html>')).toEqual([]);
  });

  it('reports XML that is not well formed, with its position', () => {
    const xml = edit('<title>Clean</title>\n    <itunes:author>', '<title>Rock & Roll</title>\n    <itunes:author>');
    const issue = find(xml, 'xml-malformed');
    expect(issue).toMatchObject({ level: 'should', area: 'file' });
    expect(issue?.message).toMatch(/line \d+, column \d+/);
  });

  describe('should fix — data MSP cannot keep', () => {
    it('flags several channel value blocks, and MSP really does read none of them', () => {
      const block = '<podcast:value type="lightning" method="keysend"><podcast:valueRecipient name="B" address="b@getalby.com" split="1" type="lnaddress"/></podcast:value>';
      const xml = edit('<item>', `${block}\n    <item>`);
      expect(find(xml, 'value-blocks-multiple')).toMatchObject({ level: 'should', area: 'value' });
      expect(find(xml, 'value-blocks-multiple')?.itemIndex).toBeUndefined();
      // Paired: the message says the splits are empty.
      expect(parseRssFeed(xml).value.recipients).toEqual([]);
    });

    it('flags several item value blocks against that item', () => {
      const block = '<podcast:value type="lightning" method="keysend"><podcast:valueRecipient name="B" address="b@getalby.com" split="1" type="lnaddress"/></podcast:value>';
      const xml = edit('</item>', `${block}\n    </item>`);
      expect(find(xml, 'value-blocks-multiple')).toMatchObject({ area: 'tracks', itemIndex: 0 });
      // Paired: the item reads no recipients of its own.
      expect(parseRssFeed(xml).tracks[0].value?.recipients ?? []).toEqual([]);
    });

    it('flags several transcripts, and MSP really does keep none', () => {
      const xml = edit(
        '<podcast:transcript url="https://example.com/1.srt" type="application/x-subrip"/>',
        '<podcast:transcript url="https://example.com/1.srt" type="application/x-subrip"/><podcast:transcript url="https://example.com/1.vtt" type="text/vtt"/>'
      );
      expect(find(xml, 'transcripts-multiple')).toMatchObject({ level: 'should', itemIndex: 0 });
      expect(parseRssFeed(xml).tracks[0].transcriptUrl).toBe('');
    });

    it('flags items in a publisher feed, and MSP really does drop them', () => {
      const xml = edit('<podcast:medium>music</podcast:medium>', '<podcast:medium>publisher</podcast:medium>');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['publisher-items-dropped']);
      expect(generatePublisherRssFeed(parsePublisherRssFeed(xml))).not.toContain('<item>');
    });
  });

  describe('updated by MSP when you save', () => {
    it('legacy explicit at channel level becomes true/false', () => {
      const xml = edit('<itunes:explicit>false</itunes:explicit>', '<itunes:explicit>yes</itunes:explicit>');
      expect(find(xml, 'explicit-legacy')).toMatchObject({ level: 'outdated', area: 'feed' });
      expect(find(xml, 'explicit-legacy')?.message).toContain('"true"');
      expect(generateRssFeed(parseRssFeed(xml))).toMatch(/<channel>[\s\S]*?<itunes:explicit>true<\/itunes:explicit>/);
    });

    it('legacy explicit on items is counted once', () => {
      const xml = edit('<itunes:explicit>true</itunes:explicit>', '<itunes:explicit>clean</itunes:explicit>');
      const issue = find(xml, 'explicit-legacy');
      expect(issue).toMatchObject({ area: 'tracks' });
      expect(issue?.message).toMatch(/^1 track used/);
      expect(generateRssFeed(parseRssFeed(xml))).toMatch(/<item>[\s\S]*<itunes:explicit>false<\/itunes:explicit>/);
    });

    it('a missing medium is written as music', () => {
      const xml = edit('<podcast:medium>music</podcast:medium>', '');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['medium-missing']);
      expect(generateRssFeed(parseRssFeed(xml))).toContain('<podcast:medium>music</podcast:medium>');
    });

    it('a medium MSP does not support is reported as changed', () => {
      const xml = edit('<podcast:medium>music</podcast:medium>', '<podcast:medium>podcast</podcast:medium>');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['medium-changed']);
    });

    it('the plural podcast:images on an item becomes track art', () => {
      const xml = edit('<itunes:duration>00:03:45</itunes:duration>',
        '<itunes:duration>00:03:45</itunes:duration><podcast:images srcset="https://example.com/t-1400.jpg 1400w, https://example.com/t-3000.jpg 3000w"/>');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['podcast-images-plural']);
      const out = generateRssFeed(parseRssFeed(xml));
      const item = out.slice(out.indexOf('<item>'));
      expect(item).toContain('<itunes:image href="https://example.com/t-1400.jpg" />');
      expect(item).not.toContain('podcast:images');
    });

    it('a missing image link is filled from the channel link', () => {
      const xml = edit('<link>https://artist.example</link></image>', '</image>');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['image-link-missing']);
      expect(generateRssFeed(parseRssFeed(xml))).toMatch(/<image>[\s\S]*<link>https:\/\/artist\.example<\/link>[\s\S]*<\/image>/);
    });

    it('stays quiet about a missing image link when there is no channel link either', () => {
      let xml = edit('<link>https://artist.example</link></image>', '</image>');
      xml = edit('<link>https://artist.example</link>\n', '', xml);
      expect(codesOf(inspectFeedXml(xml))).toEqual([]);
    });

    it('non-standard publisher links are rewritten to the nested form', () => {
      const guid = '11111111-2222-4333-8444-555555555555';
      const shapes = [
        `<podcast:remoteItem medium="publisher" feedGuid="${guid}"/>`,
        `<podcast:publisher feedGuid="${guid}" medium="publisher"/>`,
        `<podcast:publisher><podcast:remoteItem medium="publisher" feedGuid="${guid}"/><podcast:remoteItem medium="publisher" feedGuid="${guid}"/></podcast:publisher>`
      ];
      for (const shape of shapes) {
        const xml = edit('<item>', `${shape}\n    <item>`);
        expect(codesOf(inspectFeedXml(xml))).toEqual(['publisher-ref-shape']);
        expect(generateRssFeed(parseRssFeed(xml))).toMatch(
          new RegExp(`<podcast:publisher>\\s*<podcast:remoteItem medium="publisher" feedGuid="${guid}" />\\s*</podcast:publisher>`)
        );
      }
      const canonical = edit('<item>', `<podcast:publisher><podcast:remoteItem medium="publisher" feedGuid="${guid}"/></podcast:publisher>\n    <item>`);
      expect(inspectFeedXml(canonical)).toEqual([]);
    });

    it('the legacy MSP node split moves to the MSP 2.0 address', () => {
      const xml = edit('</podcast:value>\n    <item>',
        `<podcast:valueRecipient name="MSP" address="${LEGACY_MSP_NODE_PUBKEY}" split="1" type="node"/></podcast:value>\n    <item>`);
      expect(codesOf(inspectFeedXml(xml))).toEqual(['legacy-msp-node']);
      expect(generateRssFeed(parseRssFeed(xml))).toContain(`address="${MSP_SUPPORT_RECIPIENT.address}" split="1" type="lnaddress"`);
    });

    it('a recipient type that contradicts the address is corrected', () => {
      // First occurrence: the channel block.
      const xml = edit('split="95" type="lnaddress"', 'split="95" type="node"');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['recipient-type']);
      expect(parseRssFeed(xml).value.recipients[0].type).toBe('lnaddress');
    });

    it('a fractional split is reported with the value MSP read', () => {
      const xml = edit('split="5" type="lnaddress" fee="true"/>\n    </podcast:value>\n    <item>',
        'split="2.5" type="lnaddress" fee="true"/>\n    </podcast:value>\n    <item>');
      const issue = find(xml, 'split-not-integer');
      expect(issue?.message).toContain('"Host" from 2.5 to 2');
      expect(parseRssFeed(xml).value.recipients[1].split).toBe(2);
    });

    it('a placeholder enclosure length is dropped for measuring', () => {
      const xml = edit('length="3600000"', 'length="33"');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['enclosure-length-placeholder']);
      expect(parseRssFeed(xml).tracks[0].enclosureLength).toBe('');
    });

    it('a missing item guid gets a new one', () => {
      const xml = edit('<guid isPermaLink="false">song-1</guid>', '');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['item-guid-missing']);
      expect(parseRssFeed(xml).tracks[0].guid).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('missing pub dates are reported at channel and item level', () => {
      let xml = edit('<pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>\n    <podcast:medium>', '<podcast:medium>');
      xml = edit('<pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>', '', xml);
      const issues = inspectFeedXml(xml).filter(issue => issue.code === 'pubdate-missing');
      expect(issues.map(issue => issue.area)).toEqual(['feed', 'tracks']);
      expect(parseRssFeed(xml).tracks[0].pubDate).toBeTruthy();
    });

    it('a missing language becomes en', () => {
      const xml = edit('<language>en</language>', '');
      expect(codesOf(inspectFeedXml(xml))).toEqual(['language-missing']);
      expect(parseRssFeed(xml).language).toBe('en');
    });

    it('catalog titles written as element text become the title attribute', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss ${NS} version="2.0">
  <channel>
    <title>Label</title>
    <link>https://label.example</link>
    <language>en</language>
    <pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>
    <podcast:medium>publisher</podcast:medium>
    <podcast:remoteItem feedGuid="aaaaaaaa-0000-4000-8000-000000000001" medium="music">First Album</podcast:remoteItem>
    <podcast:remoteItem feedGuid="aaaaaaaa-0000-4000-8000-000000000002" medium="music" title="Second Album"/>
  </channel>
</rss>`;
      const issues = inspectFeedXml(xml);
      expect(codesOf(issues)).toEqual(['remote-item-title-text']);
      expect(issues[0].message).toMatch(/^1 catalog entry /);
      expect(generatePublisherRssFeed(parsePublisherRssFeed(xml))).toContain('title="First Album"');
    });
  });
});

describe('describeImportError', () => {
  it('names the line and column when the XML is broken', () => {
    expect(describeImportError('<rss><channel><title>A</titl></channel></rss>', new Error('Closing Tag is not closed.')))
      .toMatch(/^Couldn't import this feed: XML error at line 1, column \d+ — Expected closing tag 'title'/);
  });

  it('explains a document that is not an RSS feed', () => {
    expect(describeImportError('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', new Error('Invalid RSS feed: missing channel element')))
      .toBe("Couldn't import this feed: it has no <rss><channel>. MSP imports RSS feeds — Atom feeds and web pages won't load.");
  });

  it('explains a real web page, which is never well-formed XML', () => {
    const html = '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="a.css"></head><body><p>Hi<br></p></body></html>';
    expect(describeImportError(html, new Error('Invalid RSS feed: missing channel element')))
      .toBe("Couldn't import this feed: it has no <rss><channel>. MSP imports RSS feeds — Atom feeds and web pages won't load.");
  });

  it('counts leading blank lines into the line number', () => {
    expect(describeImportError('\n\n<rss><channel><title>A</title></channel></rss', new Error('Closing Tag is not closed.')))
      .toMatch(/^Couldn't import this feed: XML error at line 3,/);
  });

  it('falls back to the error message', () => {
    expect(describeImportError('', new Error('boom'))).toBe("Couldn't import this feed: boom");
  });
});

describe('pasted XML with leading whitespace', () => {
  it('is not reported as malformed', () => {
    expect(inspectFeedXml(`\n  \n${CLEAN_FEED}`)).toEqual([]);
  });
});

describe('source findings over time', () => {
  const snapshot = (xml: string): FeedSnapshot => ({ feedType: 'album', album: parseRssFeed(xml), publisherFeed: null });

  it('bind to the track by document order and follow it through a reorder', () => {
    const second = CLEAN_FEED.replace(/<item>[\s\S]*<\/item>/, match =>
      `${match}\n    ${match.replace('song-1', 'song-2').replace('1.srt', '2.srt"/><podcast:transcript url="https://example.com/2.vtt')}`);
    const feed = snapshot(second);
    const bound = bindSourceFindings(inspectFeedXml(second), feed.album.tracks);
    const transcripts = bound.find(issue => issue.code === 'transcripts-multiple');
    expect(transcripts?.trackId).toBe(feed.album.tracks[1].id);

    feed.album.tracks.reverse();
    expect(openSourceFindings(bound, feed)).toContainEqual(transcripts);
  });

  it('drop the value-block finding once splits are entered again', () => {
    const block = '<podcast:value type="lightning" method="keysend"><podcast:valueRecipient name="B" address="b@getalby.com" split="1" type="lnaddress"/></podcast:value>';
    const xml = edit('<item>', `${block}\n    <item>`);
    const feed = snapshot(xml);
    const bound = bindSourceFindings(inspectFeedXml(xml), feed.album.tracks);
    expect(codesOf(openSourceFindings(bound, feed))).toContain('value-blocks-multiple');
    feed.album.value.recipients = [{ name: 'A', address: 'a@getalby.com', split: 100, type: 'lnaddress' }];
    expect(codesOf(openSourceFindings(bound, feed))).not.toContain('value-blocks-multiple');
  });

  it('drop the transcript finding once a lyrics URL is set, and any finding whose track is gone', () => {
    const xml = edit(
      '<podcast:transcript url="https://example.com/1.srt" type="application/x-subrip"/>',
      '<podcast:transcript url="https://example.com/1.srt"/><podcast:transcript url="https://example.com/1.vtt"/>'
    );
    const feed = snapshot(xml);
    const bound = bindSourceFindings(inspectFeedXml(xml), feed.album.tracks);
    expect(openSourceFindings(bound, feed)).toHaveLength(1);
    feed.album.tracks[0].transcriptUrl = 'https://example.com/1.srt';
    expect(openSourceFindings(bound, feed)).toEqual([]);
    feed.album.tracks[0].transcriptUrl = '';
    feed.album.tracks = [];
    expect(openSourceFindings(bound, feed)).toEqual([]);
  });
});
