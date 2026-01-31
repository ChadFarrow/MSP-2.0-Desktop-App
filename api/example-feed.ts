import type { VercelRequest, VercelResponse } from '@vercel/node';

// MSP 2.0 Example Feed - Reference Template
// URL: /api/example-feed.xml
//
// This feed demonstrates all Podcasting 2.0 features supported by MSP:
// - Value 4 Value (Lightning payments)
// - Person credits with groups/roles
// - Track-level value overrides
// - Transcript/lyrics support
// - iTunes compatibility tags

const EXAMPLE_FEED = `<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
    <channel>
        <title>MSP Example Album</title>
        <itunes:author>MSP Demo Band</itunes:author>
        <description>This is an example feed created with MSP 2.0 (Music Side Project Studio). It demonstrates Podcasting 2.0 features including Value 4 Value Lightning payments, person credits, track-level value splits, and lyrics/transcript support. Use this as a reference when building your own music feeds.</description>
        <link>https://msp.podtards.com</link>
        <language>en</language>
        <generator>MSP 2.0 - Music Side Project Studio</generator>
        <pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>
        <lastBuildDate>Sat, 01 Feb 2025 00:00:00 GMT</lastBuildDate>
        <podcast:locked owner="example@msp.podtards.com">no</podcast:locked>
        <podcast:guid>550e8400-e29b-41d4-a716-446655440000</podcast:guid>
        <itunes:category text="Music" />
        <podcast:location>The Interwebs</podcast:location>
        <managingEditor>example@msp.podtards.com</managingEditor>
        <image>
            <url>https://msp.podtards.com/msp-logo.png</url>
            <title>MSP Example Album</title>
            <link>https://msp.podtards.com</link>
            <description>MSP Example Album artwork</description>
        </image>
        <podcast:medium>music</podcast:medium>
        <podcast:person href="https://msp.podtards.com" img="https://msp.podtards.com/msp-logo.png" group="music" role="band">MSP Demo Band</podcast:person>
        <podcast:person group="music" role="vocalist">Demo Singer</podcast:person>
        <podcast:person group="music" role="guitarist">Demo Guitarist</podcast:person>
        <podcast:person group="audio-post-production" role="producer">Demo Producer</podcast:person>
        <podcast:value type="lightning" method="keysend" suggested="0.000033333">
            <podcast:valueRecipient name="MSP Demo Band" address="msp@getalby.com" split="95" type="lnaddress" />
            <podcast:valueRecipient name="Podcast Index" address="03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a" split="1" type="node" fee="true" />
            <podcast:valueRecipient name="MSP" address="podtards@strike.me" split="4" type="lnaddress" />
        </podcast:value>
        <podcast:funding url="https://msp.podtards.com">Support MSP Development</podcast:funding>
        <item>
            <title>First Track</title>
            <description>The opening track of the album. Uses the album-level value block and person credits.</description>
            <pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>
            <guid isPermaLink="false">msp-example-track-001</guid>
            <enclosure url="https://example.com/audio/track01.mp3" length="5242880" type="audio/mpeg" />
            <itunes:duration>00:03:45</itunes:duration>
            <itunes:image href="https://msp.podtards.com/msp-logo.png" />
            <podcast:episode>1</podcast:episode>
        </item>
        <item>
            <title>Track with Lyrics</title>
            <description>This track includes a transcript for synchronized lyrics display in podcast apps that support it.</description>
            <pubDate>Sat, 01 Feb 2025 00:01:00 GMT</pubDate>
            <guid isPermaLink="false">msp-example-track-002</guid>
            <podcast:transcript url="https://example.com/lyrics/track02.srt" type="application/srt" />
            <enclosure url="https://example.com/audio/track02.mp3" length="6291456" type="audio/mpeg" />
            <itunes:duration>00:04:32</itunes:duration>
            <podcast:episode>2</podcast:episode>
        </item>
        <item>
            <title>Featured Collaboration</title>
            <description>This track features a guest artist with their own value split. The track-level value block overrides the album default.</description>
            <pubDate>Sat, 01 Feb 2025 00:02:00 GMT</pubDate>
            <guid isPermaLink="false">msp-example-track-003</guid>
            <enclosure url="https://example.com/audio/track03.mp3" length="7340032" type="audio/mpeg" />
            <itunes:duration>00:05:18</itunes:duration>
            <podcast:episode>3</podcast:episode>
            <podcast:person group="music" role="vocalist">Demo Singer</podcast:person>
            <podcast:person group="cast" role="guest">Featured Guest Artist</podcast:person>
            <podcast:value type="lightning" method="keysend" suggested="0.000033333">
                <podcast:valueRecipient name="MSP Demo Band" address="msp@getalby.com" split="47" type="lnaddress" />
                <podcast:valueRecipient name="Featured Guest Artist" address="guest@getalby.com" split="48" type="lnaddress" />
                <podcast:valueRecipient name="Podcast Index" address="03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a" split="1" type="node" fee="true" />
                <podcast:valueRecipient name="MSP" address="podtarts@strike.me" split="4" type="lnaddress" />
            </podcast:value>
        </item>
    </channel>
</rss>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set cache and CORS headers
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Type', 'application/rss+xml');
  res.setHeader('Access-Control-Allow-Origin', '*');

  return res.status(200).send(EXAMPLE_FEED);
}
