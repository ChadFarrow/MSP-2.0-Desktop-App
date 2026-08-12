/**
 * Real-feed corpus check — the false-positive net for /api/proxy-feed.
 *
 * Every other test in this repo mocks fetch, which is what makes them fast and
 * deterministic and also what makes them structurally unable to catch the bug
 * class that matters most here: a guard that refuses a feed which is actually
 * fine. The 17-domain allowlist passed every mocked test it had while 403ing
 * every self-hosted musician in the world.
 *
 * So this file points the *real* guard constants at *real* feeds and asserts
 * none of them would be refused. It imports the thresholds from proxy-feed.ts
 * rather than restating them, so tightening a cap there fails here instead of
 * silently shrinking what MSP can import.
 *
 * Network-dependent, therefore opt-in — `npm test` must stay hermetic:
 *
 *     MSP_FEED_CORPUS=1 npx vitest run api/_utils/feedCorpus.network.test.ts
 *
 * Run it before and after touching a guard, and paste the table into the PR.
 * A failure here is not necessarily a bug in the code under test — a musician's
 * host may simply be down. Read the printed table before believing it.
 */
import { describe, it, expect } from 'vitest';
import { isPrivateHost } from './urlSafety.js';
import { looksLikeFeedText, FEED_MARKERS } from './safeFetch.js';
import { MAX_BODY_BYTES, SNIFF_WINDOW, MAX_REDIRECTS } from '../proxy-feed.js';

const ENABLED = process.env.MSP_FEED_CORPUS === '1';
const suite = ENABLED ? describe : describe.skip;

interface Fixture {
  label: string;
  url: string;
  /** What this entry is here to keep honest. */
  guards: string;
  /** Set when the feed is known to exceed a cap; documents the limit, not a pass. */
  expectOverCap?: boolean;
}

const CORPUS: Fixture[] = [
  {
    label: 'self-hosted album (the #99 report)',
    url: 'https://headstarts.uk/msp/James-Goulding/Please-Stand-By/Please_Stand_By.xml',
    guards: 'no allowlist; nested <podcast:publisher>'
  },
  {
    label: 'self-hosted publisher feed',
    url: 'https://headstarts.uk/msp/publisher-feeds/James_Goulding_James_Goulding.xml',
    guards: 'no allowlist; channel-level remoteItems'
  },
  {
    label: 'apostrophe + %20 in the path',
    url: "https://headstarts.uk/msp/Right_Said_Fred/I'm%20a%20celebrity/I_m_A_Celebrity.xml",
    guards: 'proxy must NOT apply getFeedUrlError'
  },
  {
    label: 'Fountain publisher feed',
    url: 'https://feeds.fountain.fm/XMaAEXsuE0geYb9y64oc',
    guards: 'third-party publisher reference shape'
  },
  {
    label: 'Fountain album feed',
    url: 'https://feeds.fountain.fm/0nqce18mNO2WOe4v5Vv9',
    guards: 'nested publisher remoteItem'
  },
  {
    label: 'previously allowlisted host, w/ redirect',
    url: 'https://feeds.megaphone.fm/darknetdiaries',
    guards: 'redirect hops; ~1 MB body'
  },
  {
    label: 'very large feed',
    url: 'https://feeds.simplecast.com/54nAGcIl',
    guards: 'body cap — 18.5 MB, over Vercel’s 4.5 MB response ceiling',
    expectOverCap: true
  }
];

interface Probe {
  status: number;
  hops: number;
  bytes: number;
  markerInWindow: boolean;
  privateHostVerdict: boolean;
  finalUrl: string;
}

/** Mirrors safeFetchFollow's manual walk closely enough to count hops. */
async function probe(url: string): Promise<Probe> {
  let current = url;
  let hops = 0;
  let privateHostVerdict = false;

  for (;;) {
    privateHostVerdict ||= isPrivateHost(new URL(current).hostname);
    const response = await fetch(current, {
      redirect: 'manual',
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'MSP-FeedProxy/1.0'
      }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`redirect with no location at ${current}`);
      current = new URL(location, current).toString();
      hops++;
      if (hops > MAX_REDIRECTS) throw new Error(`exceeded ${MAX_REDIRECTS} redirects`);
      continue;
    }
    const body = await response.text();
    return {
      status: response.status,
      hops,
      bytes: new TextEncoder().encode(body).byteLength,
      markerInWindow: looksLikeFeedText(body.slice(0, SNIFF_WINDOW)),
      privateHostVerdict,
      finalUrl: current
    };
  }
}

suite('real-feed corpus (network)', () => {
  const table: Record<string, string> = {};

  for (const fixture of CORPUS) {
    it(
      `${fixture.label} — ${fixture.guards}`,
      async () => {
        const result = await probe(fixture.url);
        const overCap = result.bytes > MAX_BODY_BYTES;
        table[fixture.label] =
          `${result.status} · ${result.hops} hop(s) · ${(result.bytes / 1024).toFixed(0)} KB` +
          ` · marker=${result.markerInWindow}${overCap ? ' · OVER CAP' : ''}`;

        expect(result.status, 'host should answer 200').toBe(200);
        expect(result.hops, 'redirect chain must fit the limit').toBeLessThanOrEqual(MAX_REDIRECTS);

        // The whole point: an ordinary public feed host must never read as private.
        expect(
          result.privateHostVerdict,
          `isPrivateHost() falsely flagged a hop of ${fixture.url}`
        ).toBe(false);

        // The sniff must recognise a real feed. FEED_MARKERS is listed in the
        // message because a failure here means widening it, not deleting it.
        expect(
          result.markerInWindow,
          `no ${FEED_MARKERS.join('/')} in the first ${SNIFF_WINDOW / 1024} KB`
        ).toBe(true);

        if (fixture.expectOverCap) {
          // Documents a known limit rather than asserting the feed works. If this
          // ever goes false the fixture is stale — find a bigger feed.
          expect(overCap, 'fixture is meant to exceed the cap').toBe(true);
        } else {
          expect(
            overCap,
            `${(result.bytes / 1024 / 1024).toFixed(1)} MB exceeds the ${MAX_BODY_BYTES / 1024 / 1024} MB cap`
          ).toBe(false);
        }
      },
      30_000
    );
  }

  it('prints the corpus table', () => {
    console.table(table);
  });
});
