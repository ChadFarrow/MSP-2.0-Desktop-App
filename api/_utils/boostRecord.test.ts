import { describe, it, expect } from 'vitest';
import {
  parseBoostPayload,
  resolveTrack,
  toDerived,
  isMspSplit,
  isoWeekKey
} from './boostRecord.js';

/**
 * A real v4vmusic auto-boost, with the listener's identity replaced.
 *
 * The genuine capture named a real person in `sender_name`, `sender_id` and inside
 * `message`. This repo is public, so committing it verbatim would republish a
 * stranger's boostagram. The structure is what the test needs; the identity is not.
 */
const V4VMUSIC_TLV = {
  action: 'auto',
  value_msat_total: 100000,
  app_name: 'v4vmusic-com',
  url: 'https://feed.homegrownhits.xyz/feed.xml',
  ts: 6838,
  time: '01:53:58',
  app_version: '0.16.9',
  speed: '1',
  sender_id: 'v4vmusic-com-anon-redacted',
  sender_name: 'listener',
  name: 'MSP 2.0',
  message: 'Auto boost from listener for "ACID" by Singles - Horseheads sent from v4vmusic.com',
  podcast: 'Homegrown Hits',
  episode: 'Homegrown Hits Episode 148',
  guid: 'ac746d09-7c3b-5bcd-b28a-f12d6456ca8f',
  episode_guid: 'homegrownhits-148',
  boost_link: 'https://v4vmusic.com/songs/cmt2i2f890e8ood0ij6re7bb0',
  boost_uuid: '00000000-0000-4000-8000-000000000001',
  uuid: '00000000-0000-4000-8000-000000000002'
};

/** The shape Helipad actually POSTs: `direction` plus a flattened BoostRecord. */
function webhookBody(tlv: object, outer: Record<string, unknown> = {}) {
  return {
    direction: 'incoming',
    index: 10695,
    time: 1756400000,
    value_msat: 1000,
    value_msat_total: 100000,
    action: 4,
    sender: 'listener',
    app: 'v4vmusic-com',
    message: (tlv as { message?: string }).message ?? '',
    podcast: 'Homegrown Hits',
    episode: 'Homegrown Hits Episode 148',
    tlv: JSON.stringify(tlv),
    remote_podcast: null,
    remote_episode: null,
    reply_sent: false,
    memo: '',
    payment_info: null,
    ...outer
  };
}

describe('parseBoostPayload', () => {
  it('parses the tlv string into an object', () => {
    const parsed = parseBoostPayload(webhookBody(V4VMUSIC_TLV));
    expect(parsed).not.toBeNull();
    expect(parsed!.tlv.boost_link).toBe('https://v4vmusic.com/songs/cmt2i2f890e8ood0ij6re7bb0');
    expect(parsed!.tlv.guid).toBe('ac746d09-7c3b-5bcd-b28a-f12d6456ca8f');
  });

  it('survives a tlv that is not valid JSON', () => {
    const parsed = parseBoostPayload(webhookBody(V4VMUSIC_TLV, { tlv: '{not json' }));
    expect(parsed).not.toBeNull();
    expect(parsed!.tlv).toEqual({});
  });

  it('survives a missing tlv entirely', () => {
    const parsed = parseBoostPayload(webhookBody(V4VMUSIC_TLV, { tlv: undefined }));
    expect(parsed).not.toBeNull();
    expect(parsed!.tlv).toEqual({});
  });

  it('rejects a payload with no usable index, since index is the dedup key', () => {
    expect(parseBoostPayload(webhookBody(V4VMUSIC_TLV, { index: undefined }))).toBeNull();
    expect(parseBoostPayload(webhookBody(V4VMUSIC_TLV, { index: 'abc' }))).toBeNull();
    expect(parseBoostPayload(null)).toBeNull();
    expect(parseBoostPayload('nope')).toBeNull();
  });

  it('reads action from the outer numeric field, not the tlv string', () => {
    // The two fields share a name and disagree on type. 4 is an automated boost.
    expect(parseBoostPayload(webhookBody(V4VMUSIC_TLV))!.actionName).toBe('auto');
    expect(parseBoostPayload(webhookBody({ ...V4VMUSIC_TLV, action: 'boost' }, { action: 1 }))!.actionName)
      .toBe('stream');
  });

  it('falls back to the tlv action name when the outer number is unrecognized', () => {
    const parsed = parseBoostPayload(webhookBody({ ...V4VMUSIC_TLV, action: 'boost' }, { action: 99 }));
    expect(parsed!.actionName).toBe('boost');
  });

  it('defaults direction to incoming and honours an explicit outgoing', () => {
    expect(parseBoostPayload(webhookBody(V4VMUSIC_TLV))!.direction).toBe('incoming');
    expect(parseBoostPayload(webhookBody(V4VMUSIC_TLV, { direction: 'outgoing' }))!.direction)
      .toBe('outgoing');
  });
});

describe('isMspSplit', () => {
  it('is true when the tlv recipient name is the MSP support recipient', () => {
    expect(isMspSplit(parseBoostPayload(webhookBody(V4VMUSIC_TLV))!)).toBe(true);
  });

  it('is false for a boost paid to some other recipient on the same node', () => {
    const other = parseBoostPayload(webhookBody({ ...V4VMUSIC_TLV, name: 'Podcastindex.org' }))!;
    expect(isMspSplit(other)).toBe(false);
  });

  it('is false when the tlv carries no name at all', () => {
    const tlv = { ...V4VMUSIC_TLV } as Record<string, unknown>;
    delete tlv.name;
    expect(isMspSplit(parseBoostPayload(webhookBody(tlv))!)).toBe(false);
  });
});

describe('resolveTrack', () => {
  it('prefers the canonical remote guids and keys on them', () => {
    const parsed = parseBoostPayload(webhookBody(
      { ...V4VMUSIC_TLV, remote_feed_guid: 'b8b6971e-403e-568f-a4e6-7aa2b45e50d4', remote_item_guid: '72a3b402-8491-4cd9-823e-a621fd81b86f' },
      { remote_podcast: 'Some Artist', remote_episode: 'Some Song' }
    ))!;
    const track = resolveTrack(parsed);
    expect(track.trackSource).toBe('remote-guid');
    expect(track.trackKey).toBe('guid:b8b6971e-403e-568f-a4e6-7aa2b45e50d4:72a3b402-8491-4cd9-823e-a621fd81b86f');
    expect(track.trackTitle).toBe('Some Song');
    expect(track.trackArtist).toBe('Some Artist');
  });

  it('falls back to Helipad-resolved remote titles when the guids are absent', () => {
    const parsed = parseBoostPayload(webhookBody(
      V4VMUSIC_TLV,
      { remote_podcast: 'Some Artist', remote_episode: 'Some Song' }
    ))!;
    const track = resolveTrack(parsed);
    expect(track.trackSource).toBe('remote-title');
    expect(track.trackKey).toBe('title:some artist|some song');
  });

  it('uses boost_link as a stable key and takes the title from the message', () => {
    const track = resolveTrack(parseBoostPayload(webhookBody(V4VMUSIC_TLV))!);
    expect(track.trackSource).toBe('boost-link');
    expect(track.trackKey).toBe('link:https://v4vmusic.com/songs/cmt2i2f890e8ood0ij6re7bb0');
    expect(track.trackTitle).toBe('ACID');
    expect(track.trackArtist).toBe('Singles - Horseheads');
    expect(track.hasMessageTitle).toBe(true);
  });

  it('reports timesplit when only a playback position and a show guid survive', () => {
    const tlv = { ...V4VMUSIC_TLV } as Record<string, unknown>;
    delete tlv.boost_link;
    tlv.message = 'great show!';
    const track = resolveTrack(parseBoostPayload(webhookBody(tlv))!);
    expect(track.trackSource).toBe('timesplit');
    // Nothing identifies the track yet, so it must not invent a key.
    expect(track.trackKey).toBeUndefined();
    expect(track.hasMessageTitle).toBe(false);
  });

  it('falls back to the message when there is no playback position either', () => {
    const tlv = { ...V4VMUSIC_TLV } as Record<string, unknown>;
    delete tlv.boost_link;
    delete tlv.ts;
    const track = resolveTrack(parseBoostPayload(webhookBody(tlv))!);
    expect(track.trackSource).toBe('message');
    expect(track.trackTitle).toBe('ACID');
    expect(track.trackKey).toBe('title:singles horseheads|acid');
  });

  it('reports none when nothing identifies a track', () => {
    const track = resolveTrack(parseBoostPayload(webhookBody({ name: 'MSP 2.0' }, { message: 'thanks!' }))!);
    expect(track.trackSource).toBe('none');
    expect(track.trackKey).toBeUndefined();
  });

  it('reads a smart-quoted title and strips a trailing sent-from clause', () => {
    const tlv = { ...V4VMUSIC_TLV } as Record<string, unknown>;
    delete tlv.boost_link;
    delete tlv.ts;
    tlv.message = 'Auto boost from listener for “Don’t Stop” by The Band sent from example.com';
    const track = resolveTrack(parseBoostPayload(webhookBody(tlv))!);
    expect(track.trackTitle).toBe('Don’t Stop');
    expect(track.trackArtist).toBe('The Band');
  });
});

describe('toDerived', () => {
  it('carries the amounts, the show and the track, and drops every listener field', () => {
    const parsed = parseBoostPayload(webhookBody(V4VMUSIC_TLV))!;
    const derived = toDerived(parsed);

    expect(derived.index).toBe(10695);
    expect(derived.valueMsat).toBe(1000);
    expect(derived.valueMsatTotal).toBe(100000);
    expect(derived.app).toBe('v4vmusic-com');
    expect(derived.isMspSplit).toBe(true);
    expect(derived.showGuid).toBe('ac746d09-7c3b-5bcd-b28a-f12d6456ca8f');
    expect(derived.showUrl).toBe('https://feed.homegrownhits.xyz/feed.xml');
    expect(derived.playbackTs).toBe(6838);
    expect(derived.trackTitle).toBe('ACID');

    // The privacy boundary. Anything here can reach a public page later.
    const serialized = JSON.stringify(derived);
    expect(serialized).not.toContain('listener');
    expect(serialized).not.toContain('v4vmusic-com-anon-redacted');
    expect(serialized).not.toContain('Auto boost from');
    for (const banned of ['message', 'sender', 'senderName', 'senderId', 'replyAddress']) {
      expect(Object.keys(derived)).not.toContain(banned);
    }
  });
});

describe('isoWeekKey', () => {
  it('buckets by ISO week', () => {
    // 2026-08-29 is a Saturday in ISO week 35.
    expect(isoWeekKey(Date.UTC(2026, 7, 29) / 1000)).toBe('2026-W35');
  });

  it('puts a Thursday-rule year boundary in the right year', () => {
    // 2027-01-01 is a Friday, so it belongs to ISO week 53 of 2026.
    expect(isoWeekKey(Date.UTC(2027, 0, 1) / 1000)).toBe('2026-W53');
  });

  it('zero-pads a single-digit week so the keys sort', () => {
    expect(isoWeekKey(Date.UTC(2026, 0, 8) / 1000)).toBe('2026-W02');
  });
});
