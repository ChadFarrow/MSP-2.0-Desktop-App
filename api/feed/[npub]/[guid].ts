import type { VercelRequest, VercelResponse } from '@vercel/node';
import { WebSocket } from 'ws';

// Bech32 alphabet for decoding npub
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

// Default relays to query
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

// Kind 1063 for file metadata (NIP-94)
const FILE_METADATA_KIND = 1063;

// Convert 5-bit words to 8-bit bytes
function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }
  return ret;
}

// Decode npub to hex pubkey
function npubToHex(npub: string): string {
  if (!npub.startsWith('npub1')) {
    throw new Error('Invalid npub: must start with npub1');
  }

  const data = npub.slice(5);
  const words: number[] = [];

  // Decode bech32 chars (excluding 6-char checksum)
  for (let i = 0; i < data.length - 6; i++) {
    const idx = BECH32_ALPHABET.indexOf(data[i]);
    if (idx === -1) {
      throw new Error('Invalid bech32 character');
    }
    words.push(idx);
  }

  const bytes = convertBits(words, 5, 8, false);
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

interface NostrEvent {
  id?: string;
  kind: number;
  pubkey?: string;
  created_at: number;
  tags: string[][];
  content: string;
}

// Query a single relay for the latest file metadata event
function queryRelay(
  relayUrl: string,
  pubkey: string,
  dTag: string,
  timeout = 5000
): Promise<NostrEvent | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(relayUrl);
    const subId = Math.random().toString(36).substring(7);
    let latestEvent: NostrEvent | null = null;
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(latestEvent);
      }
    }, timeout);

    ws.on('open', () => {
      const filter = {
        kinds: [FILE_METADATA_KIND],
        authors: [pubkey],
        '#d': [dTag],
        limit: 1
      };
      ws.send(JSON.stringify(['REQ', subId, filter]));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1] === subId) {
          const event = msg[2] as NostrEvent;
          if (!latestEvent || event.created_at > latestEvent.created_at) {
            latestEvent = event;
          }
        } else if (msg[0] === 'EOSE' && msg[1] === subId) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            ws.close();
            resolve(latestEvent);
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(null);
      }
    });
  });
}

// Query multiple relays and return the latest event
async function queryRelays(pubkey: string, dTag: string): Promise<NostrEvent | null> {
  const results = await Promise.allSettled(
    RELAYS.map(relay => queryRelay(relay, pubkey, dTag))
  );

  let latestEvent: NostrEvent | null = null;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      if (!latestEvent || result.value.created_at > latestEvent.created_at) {
        latestEvent = result.value;
      }
    }
  }

  return latestEvent;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { npub, guid: guidParam } = req.query;
  let guid = guidParam;

  // Validate parameters
  if (typeof npub !== 'string' || typeof guid !== 'string') {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  // Strip .xml extension if present (support both /guid and /guid.xml)
  if (guid.endsWith('.xml')) {
    guid = guid.slice(0, -4);
  }

  // Validate npub format
  if (!npub.startsWith('npub1') || npub.length !== 63) {
    return res.status(400).json({ error: 'Invalid npub format' });
  }

  // Validate guid format (basic UUID check)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(guid)) {
    return res.status(400).json({ error: 'Invalid guid format' });
  }

  try {
    // Decode npub to hex pubkey
    const pubkey = npubToHex(npub);

    // Query relays for the latest file metadata event
    const event = await queryRelays(pubkey, guid);

    if (!event) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    // Extract URL from tags
    const urlTag = event.tags.find(t => t[0] === 'url');
    if (!urlTag || !urlTag[1]) {
      return res.status(404).json({ error: 'No URL in event' });
    }

    const feedUrl = urlTag[1];

    // No caching - always fetch latest from Nostr
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Redirect to the Blossom URL
    return res.redirect(302, feedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
