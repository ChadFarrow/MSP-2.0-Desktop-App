import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../../test/utils';
import { SaveModal } from './SaveModal';
import { generateTestAlbum } from '../../utils/testData';
import type { Album } from '../../types/feed';
import { getHostedFeedInfo, updateHostedFeed, createHostedFeed } from '../../utils/hostedFeed';

vi.mock('../../store/nostrStore', () => ({
  useNostr: () => ({ state: { isLoggedIn: false, user: null } })
}));

// The network calls only: the modal's own flow is what is under test.
vi.mock('../../utils/hostedFeed', async importOriginal => ({
  ...await importOriginal<typeof import('../../utils/hostedFeed')>(),
  getHostedFeedInfo: vi.fn(),
  saveHostedFeedInfo: vi.fn(),
  updateHostedFeed: vi.fn(),
  createHostedFeed: vi.fn()
}));

const GUID = '9b2c1f4e-1111-4222-8333-444455556666';
const HIDDEN_NOTICE = /Listing is set to hidden, so MSP did not ask Podcast Index to add this feed/;
const SUBMITTED_NOTE = /Feed submitted to Podcast Index/;

// A complete album, so the modal's required-field check lets the save through.
function album(listing: { itunesBlock: boolean }): Album {
  return { ...generateTestAlbum(), podcastGuid: GUID, ...listing };
}

function renderModal(feed: Album) {
  render(<SaveModal onClose={vi.fn()} album={feed} isDirty={false} isLoggedIn={false} />);
  fireEvent.click(screen.getByRole('button', { name: /Save Destination/ }));
  fireEvent.click(screen.getByRole('option', { name: /Host on MSP/ }));
}

// Ported from the web repo's SaveModal.tsx (MSP-2.0#150), which the sync could not
// bring: this fork's modal has its own Podcast Index box. A hidden feed is pinged
// so directories drop it, but MSP no longer asks Podcast Index to add it, so
// "submitted ... add manually" would be wrong — adding it by hand undoes the choice.
describe('SaveModal hosted save of a hidden feed', () => {
  beforeEach(() => {
    vi.mocked(getHostedFeedInfo).mockReset();
    vi.mocked(updateHostedFeed).mockReset();
    vi.mocked(createHostedFeed).mockReset();
  });

  describe('updating a hosted feed that Podcast Index already lists', () => {
    beforeEach(() => {
      vi.mocked(getHostedFeedInfo).mockReturnValue({ feedId: GUID, editToken: 'token', createdAt: 1, lastUpdated: 1 });
      // The server returns the id it already had, hidden or not.
      vi.mocked(updateHostedFeed).mockResolvedValue({ success: true, podcastIndexId: 123 });
    });

    it('a listed feed still reports the Podcast Index submission', async () => {
      renderModal(album({ itunesBlock: false }));
      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
      await waitFor(() => expect(screen.getByText(SUBMITTED_NOTE)).toBeInTheDocument());
      expect(screen.queryByText(HIDDEN_NOTICE)).not.toBeInTheDocument();
    });

    it('a hidden feed says Podcast Index was not asked to add it, and offers no manual add', async () => {
      renderModal(album({ itunesBlock: true }));
      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
      await waitFor(() => expect(screen.getByText(HIDDEN_NOTICE)).toBeInTheDocument());
      expect(screen.queryByText(SUBMITTED_NOTE)).not.toBeInTheDocument();
      expect(screen.queryByText(/add manually/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Podcast Index notified/)).not.toBeInTheDocument();
    });

    it('a hidden feed saved as a draft gets no Podcast Index notice', async () => {
      vi.mocked(updateHostedFeed).mockResolvedValue({ success: true, isDraft: true });
      renderModal(album({ itunesBlock: true }));
      fireEvent.click(screen.getByLabelText(/Draft mode/));
      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
      await waitFor(() => expect(screen.getByText('Feed updated as draft!')).toBeInTheDocument());
      expect(screen.queryByText(HIDDEN_NOTICE)).not.toBeInTheDocument();
    });
  });

  it('creating a hidden feed shows the notice, though the server returns no id', async () => {
    vi.mocked(getHostedFeedInfo).mockReturnValue(null);
    vi.mocked(createHostedFeed).mockResolvedValue({ feedId: GUID, editToken: 'token', url: '', blobUrl: '' });
    renderModal(album({ itunesBlock: true }));
    fireEvent.click(screen.getByLabelText(/I have saved my edit token/));
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(screen.getByText(/Feed created!/)).toBeInTheDocument());
    expect(screen.getByText(HIDDEN_NOTICE)).toBeInTheDocument();
  });
});
