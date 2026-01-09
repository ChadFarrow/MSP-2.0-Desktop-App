// Nostr relay connection and publishing utilities
import type { NostrEvent } from '../types/nostr';

// Default relays to use
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  // 'wss://relay.nostr.band' // Temporarily disabled - unreachable
];

/**
 * Connect to a relay with timeout (single attempt)
 */
function connectRelayOnce(url: string, timeout = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection to ${url} timed out`));
    }, timeout);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Failed to connect to ${url}`));
    };
  });
}

/**
 * Connect to a relay with timeout and retries
 */
export async function connectRelay(url: string, timeout = 8000, maxRetries = 5): Promise<WebSocket> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await connectRelayOnce(url, timeout);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Unknown error');
      // Wait before retrying (exponential backoff: 1s, 2s, 4s, 8s)
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error(`Failed to connect to ${url} after ${maxRetries} attempts`);
}

/**
 * Send a message and wait for response
 */
export function sendAndWait(
  ws: WebSocket,
  message: unknown[],
  timeout = 10000
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Request timed out'));
    }, timeout);

    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(data);
      } catch {
        // Ignore parse errors, wait for valid response
      }
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify(message));
  });
}

/**
 * Collect multiple events from a relay subscription
 */
export function collectEvents(
  ws: WebSocket,
  subscriptionId: string,
  timeout = 10000
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      resolve(events);
    }, timeout);

    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data[0] === 'EVENT' && data[1] === subscriptionId) {
          events.push(data[2] as NostrEvent);
        } else if (data[0] === 'EOSE' && data[1] === subscriptionId) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve(events);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.addEventListener('message', handler);
  });
}

/**
 * Result of publishing to a single relay
 */
export interface RelayPublishResult {
  relay: string;
  success: boolean;
  response?: unknown[];
  error?: string;
}

/**
 * Publish an event to multiple relays
 * Returns results from all relay attempts
 */
export async function publishEventToRelays(
  signedEvent: NostrEvent,
  relays = DEFAULT_RELAYS
): Promise<{ successCount: number; results: RelayPublishResult[] }> {
  const results = await Promise.allSettled(
    relays.map(async (relayUrl) => {
      const ws = await connectRelay(relayUrl);
      try {
        const response = await sendAndWait(ws, ['EVENT', signedEvent]);
        return { relay: relayUrl, success: true, response } as RelayPublishResult;
      } finally {
        ws.close();
      }
    })
  );

  const publishResults: RelayPublishResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      relay: relays[index],
      success: false,
      error: result.reason?.message || 'Unknown error'
    };
  });

  const successCount = publishResults.filter(r => r.success).length;

  return { successCount, results: publishResults };
}

/**
 * Query events from multiple relays
 * Returns deduplicated events by event ID
 */
export async function queryEventsFromRelays(
  filter: Record<string, unknown>,
  relays = DEFAULT_RELAYS,
  connectionTimeout = 5000,
  queryTimeout = 10000
): Promise<NostrEvent[]> {
  const allEvents: NostrEvent[] = [];

  const results = await Promise.allSettled(
    relays.map(async (relayUrl) => {
      const ws = await connectRelay(relayUrl, connectionTimeout);
      try {
        const subId = Math.random().toString(36).substring(7);
        ws.send(JSON.stringify(['REQ', subId, filter]));
        const events = await collectEvents(ws, subId, queryTimeout);
        return events;
      } finally {
        ws.close();
      }
    })
  );

  // Collect all events from successful relays
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    }
  }

  // Deduplicate by event ID
  const uniqueEvents = new Map<string, NostrEvent>();
  for (const event of allEvents) {
    if (event.id && !uniqueEvents.has(event.id)) {
      uniqueEvents.set(event.id, event);
    }
  }

  return Array.from(uniqueEvents.values());
}
