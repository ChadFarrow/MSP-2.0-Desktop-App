import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../../test/utils';
import { TracksSection } from './TracksSection';
import { createEmptyTrack } from '../../types/feed';
import type { Track } from '../../types/feed';
import type { FeedAction } from '../../store/feedStore';

// jsdom never loads a video's metadata, so the height lookup is stubbed.
vi.mock('../../utils/videoUtils', async importOriginal => ({
  ...await importOriginal<typeof import('../../utils/videoUtils')>(),
  detectVideoHeight: vi.fn(async () => 1080)
}));

// The Alternate Versions editor mount, ported from the web repo's Editor.tsx
// (MSP-2.0#161): this fork edits tracks here instead.
describe('TracksSection alternate versions', () => {
  afterEach(() => vi.unstubAllGlobals());

  const flacTrack = (): Track => ({
    ...createEmptyTrack(1),
    alternateEnclosures: [{ id: 'v', type: 'audio/flac', sources: [{ uri: 'https://example.com/1.flac' }] }]
  });

  it('shows on an album track and not on a video', () => {
    const { unmount } = render(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={vi.fn()} />);
    expect(screen.getByText('+ Add Alternate Version')).toBeInTheDocument();
    unmount();
    render(<TracksSection tracks={[createEmptyTrack(1, 'video/mp4')]} isVideo={true} dispatch={vi.fn()} />);
    expect(screen.queryByText('+ Add Alternate Version')).not.toBeInTheDocument();
  });

  it('adds a version to that track', () => {
    const dispatch = vi.fn<(action: FeedAction) => void>();
    render(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('+ Add Alternate Version'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_TRACK',
      payload: { index: 0, track: { alternateEnclosures: [expect.objectContaining({ type: 'audio/mpeg' })] } }
    });
  });

  it('writes a measured size by track id and version id, not through the track index', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-length': '31200000' }) }));
    const dispatch = vi.fn<(action: FeedAction) => void>();
    const track = flacTrack();
    render(<TracksSection tracks={[track]} isVideo={false} dispatch={dispatch} />);
    fireEvent.blur(screen.getByLabelText('Alternate version 1 URL'));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_ALTERNATE_ENCLOSURE_MEASURED',
      payload: { trackId: track.id, versionId: 'v', url: 'https://example.com/1.flac', field: 'length', value: '31200000' }
    }));
  });

  it('shows Height on a music video and writes a measured height the same way', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, headers: new Headers() })); // host hides the size
    const dispatch = vi.fn<(action: FeedAction) => void>();
    const track: Track = {
      ...createEmptyTrack(1),
      alternateEnclosures: [{ id: 'v', type: 'video/mp4', title: 'Music Video', sources: [{ uri: 'https://example.com/video.mp4' }] }]
    };
    render(<TracksSection tracks={[track]} isVideo={false} dispatch={dispatch} />);
    expect(screen.getByPlaceholderText('e.g., 1080')).toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('Alternate version 1 URL'));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_ALTERNATE_ENCLOSURE_MEASURED',
      payload: { trackId: track.id, versionId: 'v', url: 'https://example.com/video.mp4', field: 'height', value: '1080' }
    }));
  });
});
