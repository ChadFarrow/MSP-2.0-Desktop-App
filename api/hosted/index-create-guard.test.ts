/**
 * POST /api/hosted is unauthenticated by design — anyone may host a new feed. What it
 * must never do is let that create path take over an *existing* feed.
 *
 * It used to check only `feeds/{id}.meta.json` for duplicates and then write the XML
 * with allowOverwrite: true. So a feed whose .xml existed without a .meta.json could
 * be claimed by an anonymous POST: the live feed content was overwritten and a fresh
 * meta blob was written carrying the caller's editTokenHash. feedId is the
 * podcastGuid, which every feed publishes in its own <podcast:guid>.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockList = vi.fn();
const mockPut = vi.fn();
const mockDel = vi.fn();
vi.mock('@vercel/blob', () => ({ list: mockList, put: mockPut, del: mockDel }));

vi.mock('../_utils/accountStore.js', () => ({
  addFeedToAccount: vi.fn(async () => {}),
  removeFeedFromAccount: vi.fn(async () => {})
}));

// Keep the create path off the network: no Podcast Index call, no podping.
vi.mock('../_utils/feedUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_utils/feedUtils.js')>();
  return { ...actual, notifyPodcastIndex: vi.fn(async () => ({ podcastIndexId: null })) };
});

const GUID = '11111111-2222-3333-4444-555555555555';
const XML = '<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>';

/** Which of the two blobs already exist in the store. */
function existing({ meta = false, xml = false }: { meta?: boolean; xml?: boolean }) {
  const blobs: { pathname: string; url: string }[] = [];
  if (meta) blobs.push({ pathname: `feeds/${GUID}.meta.json`, url: 'https://blob/meta' });
  if (xml) blobs.push({ pathname: `feeds/${GUID}.xml`, url: 'https://blob/xml' });
  mockList.mockImplementation(({ prefix }: { prefix: string }) =>
    Promise.resolve({ blobs: blobs.filter(b => b.pathname.startsWith(prefix)) })
  );
}

function reqRes() {
  const req = {
    method: 'POST',
    query: {},
    headers: {},
    body: { xml: XML, title: 'T', podcastGuid: GUID }
  } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis()
  } as unknown as VercelResponse;
  return { req, res };
}

describe('POST /api/hosted create guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPut.mockResolvedValue({ url: 'https://blob/new' });
  });

  it('refuses when only the XML blob exists — the takeover case', async () => {
    existing({ xml: true, meta: false });
    const { default: handler } = await import('./index');
    const { req, res } = reqRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('still refuses when the metadata blob exists', async () => {
    existing({ meta: true, xml: true });
    const { default: handler } = await import('./index');
    const { req, res } = reqRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('still creates a genuinely new feed', async () => {
    existing({});
    const { default: handler } = await import('./index');
    const { req, res } = reqRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockPut).toHaveBeenCalled();
  });

  it('never writes the feed XML with allowOverwrite', async () => {
    existing({});
    const { default: handler } = await import('./index');
    const { req, res } = reqRes();
    await handler(req, res);

    const xmlWrite = mockPut.mock.calls.find(c => String(c[0]).endsWith('.xml'));
    expect(xmlWrite, 'expected the feed XML to be written').toBeDefined();
    expect(xmlWrite![2]).toMatchObject({ allowOverwrite: false });
  });
});
