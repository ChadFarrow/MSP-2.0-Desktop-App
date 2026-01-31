import type { VercelRequest, VercelResponse } from '@vercel/node';

// MSP 2.0 Example Feed - Reference Template
// URL: /api/example-feed
//
// This feed shows exactly what MSP 2.0 generates, including:
// - Value 4 Value (Lightning payments)
// - Person credits with groups/roles
// - Track-level value overrides
// - Transcript/lyrics support
// - iTunes compatibility tags

const EXAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
    <channel>
        <title>MSP Example Album</title>
        <itunes:author>MSP Demo Band</itunes:author>
        <description>
            This is an example feed created with MSP 2.0 (Music Side Project Studio). It demonstrates Podcasting 2.0 features including Value 4 Value Lightning payments, person credits, track-level value splits, and lyrics/transcript support. Use this as a reference when building your own music feeds.
        </description>
        <link>https://msp.podtards.com</link>
        <language>en</language>
        <generator>MSP 2.0 - Music Side Project Studio</generator>
        <pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>
        <lastBuildDate>Sat, 01 Feb 2025 00:00:00 GMT</lastBuildDate>
        <podcast:guid>550e8400-e29b-41d4-a716-446655440000</podcast:guid>
        <itunes:category text="Music" />
        <itunes:keywords>example, demo, msp, podcasting2.0, value4value</itunes:keywords>
        <image>
            <url>https://msp.podtards.com/msp-logo.png</url>
            <title>MSP Example Album</title>
            <link>https://msp.podtards.com</link>
            <description>MSP Example Album artwork</description>
        </image>
        <itunes:image href="https://msp.podtards.com/msp-logo.png" />
        <podcast:medium>music</podcast:medium>
        <itunes:explicit>false</itunes:explicit>
        <itunes:owner>
            <itunes:name>MSP Demo Band</itunes:name>
            <itunes:email>example@msp.podtards.com</itunes:email>
        </itunes:owner>
        <podcast:person href="https://msp.podtards.com" img="https://msp.podtards.com/msp-logo.png" group="music" role="band">MSP Demo Band</podcast:person>
        <podcast:person group="music" role="vocalist">Demo Singer</podcast:person>
        <podcast:person group="music" role="guitarist">Demo Guitarist</podcast:person>
        <podcast:person group="audio-post-production" role="composer">Demo Producer</podcast:person>
        <podcast:value type="lightning" method="lnaddress" suggested="0.000033333">
            <podcast:valueRecipient name="MSP Demo Band" address="msp@getalby.com" split="95" type="lnaddress" />
            <podcast:valueRecipient name="Podcast Index" address="03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a" split="1" type="node" />
            <podcast:valueRecipient name="MSP" address="podtards@strike.me" split="4" type="lnaddress" />
        </podcast:value>
        <podcast:funding url="https://msp.podtards.com">Support MSP Development</podcast:funding>
        <item>
            <title>First Track</title>
            <description>The opening track of the album. Uses the album-level value block and person credits.</description>
            <pubDate>Sat, 01 Feb 2025 00:00:00 GMT</pubDate>
            <guid isPermaLink="false">a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d</guid>
            <itunes:image href="https://msp.podtards.com/msp-logo.png" />
            <podcast:images srcset="https://msp.podtards.com/msp-logo.png" />
            <enclosure url="https://example.com/audio/track01.mp3" length="5242880" type="audio/mpeg"/>
            <itunes:duration>3:45</itunes:duration>
            <podcast:season>1</podcast:season>
            <podcast:episode>1</podcast:episode>
            <itunes:explicit>false</itunes:explicit>
            <podcast:person href="https://msp.podtards.com" img="https://msp.podtards.com/msp-logo.png" group="music" role="band">MSP Demo Band</podcast:person>
            <podcast:person group="music" role="vocalist">Demo Singer</podcast:person>
            <podcast:person group="music" role="guitarist">Demo Guitarist</podcast:person>
            <podcast:person group="audio-post-production" role="composer">Demo Producer</podcast:person>
            <podcast:value type="lightning" method="lnaddress" suggested="0.000033333">
                <podcast:valueRecipient name="MSP Demo Band" address="msp@getalby.com" split="95" type="lnaddress" />
                <podcast:valueRecipient name="Podcast Index" address="03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a" split="1" type="node" />
                <podcast:valueRecipient name="MSP" address="podtards@strike.me" split="4" type="lnaddress" />
            </podcast:value>
        </item>
        <item>
            <title>Track with Lyrics</title>
            <description>This track includes a transcript for synchronized lyrics display in podcast apps that support it.</description>
            <pubDate>Sat, 01 Feb 2025 00:01:00 GMT</pubDate>
            <guid isPermaLink="false">b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e</guid>
            <podcast:transcript url="https://example.com/lyrics/track02.srt" type="application/srt" />
            <itunes:image href="https://msp.podtards.com/msp-logo.png" />
            <podcast:images srcset="https://msp.podtards.com/msp-logo.png" />
            <enclosure url="https://example.com/audio/track02.mp3" length="6291456" type="audio/mpeg"/>
            <itunes:duration>4:32</itunes:duration>
            <podcast:season>1</podcast:season>
            <podcast:episode>2</podcast:episode>
            <itunes:explicit>false</itunes:explicit>
            <podcast:person href="https://msp.podtards.com" img="https://msp.podtards.com/msp-logo.png" group="music" role="band">MSP Demo Band</podcast:person>
            <podcast:person group="music" role="vocalist">Demo Singer</podcast:person>
            <podcast:person group="music" role="guitarist">Demo Guitarist</podcast:person>
            <podcast:person group="audio-post-production" role="composer">Demo Producer</podcast:person>
            <podcast:value type="lightning" method="lnaddress" suggested="0.000033333">
                <podcast:valueRecipient name="MSP Demo Band" address="msp@getalby.com" split="95" type="lnaddress" />
                <podcast:valueRecipient name="Podcast Index" address="03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a" split="1" type="node" />
                <podcast:valueRecipient name="MSP" address="podtards@strike.me" split="4" type="lnaddress" />
            </podcast:value>
        </item>
        <item>
            <title>Featured Collaboration</title>
            <description>This track features a guest artist with their own value split. The track-level value block overrides the album default.</description>
            <pubDate>Sat, 01 Feb 2025 00:02:00 GMT</pubDate>
            <guid isPermaLink="false">c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f</guid>
            <itunes:image href="https://msp.podtards.com/msp-logo.png" />
            <podcast:images srcset="https://msp.podtards.com/msp-logo.png" />
            <enclosure url="https://example.com/audio/track03.mp3" length="7340032" type="audio/mpeg"/>
            <itunes:duration>5:18</itunes:duration>
            <podcast:season>1</podcast:season>
            <podcast:episode>3</podcast:episode>
            <itunes:explicit>false</itunes:explicit>
            <podcast:person group="music" role="vocalist">Demo Singer</podcast:person>
            <podcast:person group="cast" role="guest">Featured Guest Artist</podcast:person>
            <podcast:value type="lightning" method="lnaddress" suggested="0.000033333">
                <podcast:valueRecipient name="MSP Demo Band" address="msp@getalby.com" split="47" type="lnaddress" />
                <podcast:valueRecipient name="Featured Guest Artist" address="guest@getalby.com" split="48" type="lnaddress" />
                <podcast:valueRecipient name="Podcast Index" address="03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a" split="1" type="node" />
                <podcast:valueRecipient name="MSP" address="podtards@strike.me" split="4" type="lnaddress" />
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
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  return res.status(200).send(EXAMPLE_FEED);
}
