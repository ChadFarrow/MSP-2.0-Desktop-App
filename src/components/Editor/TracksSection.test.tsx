import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent, waitFor } from '../../test/utils';
import { TracksSection } from './TracksSection';
import { ExperimentalProvider } from '../../store/experimentalStore';
import { createEmptyTrack } from '../../types/feed';
import type { Track } from '../../types/feed';
import type { FeedAction } from '../../store/feedStore';

// jsdom never loads a video's metadata, so the height lookup is stubbed.
vi.mock('../../utils/videoUtils', async importOriginal => ({
  ...await importOriginal<typeof import('../../utils/videoUtils')>(),
  detectVideoHeight: vi.fn(async () => 1080)
}));

// TracksSection reads the "Show Beta Features" toggle (MSP-2.0#168), which the
// store loads from localStorage — mocked in src/test/setup.ts.
function renderTracks(ui: ReactElement, { beta }: { beta: boolean }) {
  vi.mocked(localStorage.getItem).mockImplementation(key => (beta && key === 'msp-show-beta' ? 'true' : null));
  return render(<ExperimentalProvider>{ui}</ExperimentalProvider>);
}

// The Alternate Versions editor mount, ported from the web repo's Editor.tsx
// (MSP-2.0#161): this fork edits tracks here instead.
describe('TracksSection alternate versions', () => {
  afterEach(() => vi.unstubAllGlobals());

  const flacTrack = (): Track => ({
    ...createEmptyTrack(1),
    alternateEnclosures: [{ id: 'v', type: 'audio/flac', sources: [{ uri: 'https://example.com/1.flac' }] }]
  });

  it('shows on an album track and not on a video', () => {
    const { unmount } = renderTracks(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={vi.fn()} />, { beta: true });
    expect(screen.getByText('+ Add Alternate Version')).toBeInTheDocument();
    unmount();
    renderTracks(<TracksSection tracks={[createEmptyTrack(1, 'video/mp4')]} isVideo={true} dispatch={vi.fn()} />, { beta: true });
    expect(screen.queryByText('+ Add Alternate Version')).not.toBeInTheDocument();
  });

  // Web's showsAlternateVersions() (MSP-2.0#168): adding is a beta feature, but
  // a version the track already has (an import) still shows, to edit or remove.
  it('needs the beta toggle to add, and keeps an existing version without it', () => {
    const { unmount } = renderTracks(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={vi.fn()} />, { beta: false });
    expect(screen.queryByText(/Alternate Versions/)).not.toBeInTheDocument();
    unmount();
    renderTracks(<TracksSection tracks={[flacTrack()]} isVideo={false} dispatch={vi.fn()} />, { beta: false });
    expect(screen.getByLabelText('Alternate version 1 URL')).toHaveValue('https://example.com/1.flac');
    expect(screen.queryByText('+ Add Alternate Version')).not.toBeInTheDocument();
  });

  it('adds a version to that track', () => {
    const dispatch = vi.fn<(action: FeedAction) => void>();
    renderTracks(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={dispatch} />, { beta: true });
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
    renderTracks(<TracksSection tracks={[track]} isVideo={false} dispatch={dispatch} />, { beta: false });
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
    renderTracks(<TracksSection tracks={[track]} isVideo={false} dispatch={dispatch} />, { beta: false });
    expect(screen.getByPlaceholderText('e.g., 1080')).toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('Alternate version 1 URL'));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_ALTERNATE_ENCLOSURE_MEASURED',
      payload: { trackId: track.id, versionId: 'v', url: 'https://example.com/video.mp4', field: 'height', value: '1080' }
    }));
  });
});

// The "Recommended first listen" track toggle, ported from the web repo's
// Editor.tsx (MSP-2.0#162, behind the beta toggle since #168).
describe('TracksSection recommended first listen', () => {
  const label = /Recommended first listen/;

  it('shows the toggle only with the beta toggle on', () => {
    const { unmount } = renderTracks(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={vi.fn()} />, { beta: false });
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    unmount();
    renderTracks(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={vi.fn()} />, { beta: true });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('keeps it on a pinned track with the beta toggle off', () => {
    renderTracks(<TracksSection tracks={[{ ...createEmptyTrack(1), pinned: true }]} isVideo={false} dispatch={vi.fn()} />, { beta: false });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  // The highlight box and BETA tag from MSP-2.0#170 (web Editor.tsx).
  it('highlights the toggle as a beta field', () => {
    renderTracks(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={vi.fn()} />, { beta: true });
    const field = screen.getByText(label).closest('.form-group')!;
    expect(field).toHaveClass('beta-field');
    expect(field.querySelector('.beta-tag')).toHaveTextContent('Beta');
  });

  it('pins the track by its index', () => {
    const dispatch = vi.fn<(action: FeedAction) => void>();
    renderTracks(<TracksSection tracks={[createEmptyTrack(1)]} isVideo={false} dispatch={dispatch} />, { beta: true });
    const toggle = screen.getByText(label).closest('.toggle-wrapper')!.querySelector('.toggle')!;
    fireEvent.click(toggle);
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_TRACK', payload: { index: 0, track: { pinned: true } } });
  });
});
